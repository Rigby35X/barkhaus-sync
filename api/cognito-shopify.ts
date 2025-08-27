// api/cognito-shopify.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "mission-bay-puppy-rescue.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

if (!SHOP || !TOKEN || !WEBHOOK_SECRET) {
  throw new Error("Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN / WEBHOOK_SECRET env vars");
}

async function gql<T = any>(query: string, variables?: any): Promise<T> {
  const r = await fetch(`https://${SHOP}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json();
  if (!r.ok) {
    const msg = (json?.errors && JSON.stringify(json.errors)) || `HTTP ${r.status}`;
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  return json;
}

// Upload a single external image URL into Shopify "Files" and return its ID + URL
async function uploadExternalImage(url: string) {
  const res = await gql(`
    mutation($files:[FileCreateInput!]!) {
      fileCreate(files:$files) {
        files { id alt fileStatus preview { image { url } } }
        userErrors { field message }
      }
    }`,
    { files: [{ alt: "animal", contentType: "IMAGE", originalSource: url }] }
  );
  const file = res?.data?.fileCreate?.files?.[0];
  if (!file?.id) return null;
  return { id: file.id, url: file.preview?.image?.url as string | undefined };
}

const UPSERT = `
mutation UpsertAnimal($handle: String!, $name: String!, $fields: [MetaobjectFieldInput!]!, $status: PublishableStatus!) {
  metaobjectUpsert(
    handle: { type: "animal", handle: $handle }
    metaobject: {
      type: "animal",
      displayName: $name,
      fields: $fields,
      capabilities: { publishable: { status: $status } }
    }
  ) {
    metaobject { id handle type }
    userErrors { field message }
  }
}`;

/**
 * 🔧 MAPPING: Put your exact Cognito field keys here.
 * Fill in the strings on the right with your Cognito field names exactly as they appear in the payload.
 */
const MAP = {
  externalId: ["Entry ID", "entryId", "Number", "id"], // at least one of these should exist
  name:       ["Name", "Dog Name", "name", "dog_name"],
  status:     ["Status", "status"],                     // e.g. "available", "adopted", "hold"
  species:    ["Species", "species"],
  breed:      ["Breed", "breed"],
  age:        ["Age", "age"],
  gender:     ["Gender", "gender"],
  size:       ["Size", "size"],
  location:   ["Location", "location", "City"],
  adoptionFee:["Adoption Fee", "adoption_fee", "AdoptionFee"],
  description:["Description", "description"],
  imageUrl:   ["Image Url", "ImageUrl", "image_url", "PhotoUrl"],  // single image
  gallery:    ["Gallery Urls", "Gallery", "image_urls"],           // array of URLs if you have it
  goodWithKids:["Good With Kids","good_with_kids"],
  goodWithDogs:["Good With Dogs","good_with_dogs"],
  goodWithCats:["Good With Cats","good_with_cats"],
  houseTrained:["House Trained","house_trained"],
  spayedNeutered:["Spayed/Neutered","spayed_neutered"],
  vaccinated: ["Vaccinated","vaccinated"],
} as const;

// Utility: get first non-empty value from possible keys
function pick(payload: any, keys: string[], fallback: any = "") {
  for (const k of keys) {
    const v = payload?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    // Basic shared-secret check so randoms can't spam your endpoint
    const sig = req.headers["x-webhook-secret"] as string;
    if (!sig || sig !== WEBHOOK_SECRET) return res.status(401).send("Unauthorized");

    const payload = req.body || {};
    // ---- Map Cognito → normalized values ----
    const externalId = String(pick(payload, MAP.externalId, "")).trim();
    if (!externalId) return res.status(400).send("Missing external id (e.g., Entry ID)");

    const name        = String(pick(payload, MAP.name, "Unnamed")).trim();
    const statusRaw   = String(pick(payload, MAP.status, "available")).toLowerCase();
    const species     = String(pick(payload, MAP.species, "Dog"));
    const breed       = String(pick(payload, MAP.breed, ""));
    const age         = String(pick(payload, MAP.age, ""));
    const gender      = String(pick(payload, MAP.gender, ""));
    const size        = String(pick(payload, MAP.size, ""));
    const location    = String(pick(payload, MAP.location, ""));
    const adoptionFee = String(pick(payload, MAP.adoptionFee, ""));
    const description = String(pick(payload, MAP.description, ""));

    const imageUrl    = String(pick(payload, MAP.imageUrl, ""));
    let galleryUrls: string[] = [];
    {
      const g = payload?.[MAP.gallery[0]] ?? payload?.[MAP.gallery[1]] ?? payload?.[MAP.gallery[2]];
      if (Array.isArray(g)) galleryUrls = g.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
      else if (typeof g === "string" && g.includes(",")) {
        galleryUrls = g.split(",").map((s) => s.trim()).filter((u) => /^https?:\/\//.test(u));
      }
    }

    // booleans
    const good_with_kids  = !!pick(payload, MAP.goodWithKids, false);
    const good_with_dogs  = !!pick(payload, MAP.goodWithDogs, false);
    const good_with_cats  = !!pick(payload, MAP.goodWithCats, false);
    const house_trained   = !!pick(payload, MAP.houseTrained, false);
    const spayed_neutered = !!pick(payload, MAP.spayedNeutered, false);
    const vaccinated      = !!pick(payload, MAP.vaccinated, false);

    // Determine publish status from status field
    const publishStatus = (statusRaw === "available") ? "ACTIVE" : "DRAFT";

    // ---- Build field list for Shopify metaobject ----
    const fields: any[] = [
      { key: "external_id",  value: externalId },
      { key: "name",         value: name },
      { key: "status",       value: statusRaw },
      { key: "species",      value: species },
      { key: "breed",        value: breed },
      { key: "age",          value: age },
      { key: "gender",       value: gender },
      { key: "size",         value: size },
      { key: "location",     value: location },
      { key: "adoption_fee", value: adoptionFee },
      { key: "good_with_kids",  value: String(good_with_kids),  type: "boolean" },
      { key: "good_with_dogs",  value: String(good_with_dogs),  type: "boolean" },
      { key: "good_with_cats",  value: String(good_with_cats),  type: "boolean" },
      { key: "house_trained",   value: String(house_trained),   type: "boolean" },
      { key: "spayed_neutered", value: String(spayed_neutered), type: "boolean" },
      { key: "vaccinated",      value: String(vaccinated),      type: "boolean" },
      // rich_text: wrap paragraphs so Shopify keeps line breaks
      { key: "description",  value: `<p>${description.replace(/\n+/g, "</p><p>")}</p>`, type: "rich_text_field" },
    ];

    // ---- Upload primary image (optional) ----
    if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      const uploaded = await uploadExternalImage(imageUrl).catch(() => null);
      if (uploaded?.id) {
        fields.push({ key: "image", value: uploaded.id, type: "file_reference" });
      }
    }

    // ---- Upload gallery (optional) ----
    if (galleryUrls.length) {
      const fileIds: string[] = [];
      for (const url of galleryUrls.slice(0, 12)) {
        if (!/^https?:\/\//.test(url)) continue;
        const uploaded = await uploadExternalImage(url).catch(() => null);
        if (uploaded?.id) fileIds.push(uploaded.id);
      }
      if (fileIds.length) {
        fields.push({ key: "gallery", value: JSON.stringify(fileIds), type: "list.file_reference" });
      }
    }

    // ---- Upsert by handle = externalId ----
    const result = await gql(UPSERT, {
      handle: externalId,
      name,
      fields,
      status: publishStatus, // ACTIVE for available; DRAFT otherwise
    });

    const err = result?.data?.metaobjectUpsert?.userErrors?.[0];
    if (err) return res.status(400).json(err);

    return res.status(200).json({
      ok: true,
      id: result?.data?.metaobjectUpsert?.metaobject?.id,
      handle: externalId,
      status: publishStatus,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

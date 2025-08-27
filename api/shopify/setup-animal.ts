// api/shopify/setup-animal.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "mission-bay-puppy-rescue.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SETUP_SECRET = process.env.SETUP_SECRET!;

if (!SHOP || !TOKEN || !SETUP_SECRET) {
  throw new Error("Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN / SETUP_SECRET env vars");
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

const GET_DEFINITION = `
query($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
    name
    type
    displayNameKey
    fieldDefinitions { name key type required }
  }
}`;

const CREATE_DEFINITION = `
mutation($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition { id type name displayNameKey }
    userErrors { field message }
  }
}`;

const UPDATE_DEFINITION = `
mutation($id: ID!, $fieldDefinitionsToUpdate: [MetaobjectFieldDefinitionUpdateInput!], $fieldDefinitionsToCreate: [MetaobjectFieldDefinitionCreateInput!]) {
  metaobjectDefinitionUpdate(
    id: $id,
    fieldDefinitionsToUpdate: $fieldDefinitionsToUpdate,
    fieldDefinitionsToCreate: $fieldDefinitionsToCreate
  ) {
    metaobjectDefinition { id }
    userErrors { field message }
  }
}`;

// Canonical field set (add/remove as you like)
const FIELDS = [
  { name: "Name",            key: "name",            type: "single_line_text_field", required: true },
  { name: "Status",          key: "status",          type: "single_line_text_field" },
  { name: "Species",         key: "species",         type: "single_line_text_field" },
  { name: "Breed",           key: "breed",           type: "single_line_text_field" },
  { name: "Age",             key: "age",             type: "single_line_text_field" },
  { name: "Gender",          key: "gender",          type: "single_line_text_field" },
  { name: "Size",            key: "size",            type: "single_line_text_field" },
  { name: "Location",        key: "location",        type: "single_line_text_field" },
  { name: "Adoption Fee",    key: "adoption_fee",    type: "single_line_text_field" },
  { name: "Good With Kids",  key: "good_with_kids",  type: "boolean" },
  { name: "Good With Dogs",  key: "good_with_dogs",  type: "boolean" },
  { name: "Good With Cats",  key: "good_with_cats",  type: "boolean" },
  { name: "House Trained",   key: "house_trained",   type: "boolean" },
  { name: "Spayed/Neutered", key: "spayed_neutered", type: "boolean" },
  { name: "Vaccinated",      key: "vaccinated",      type: "boolean" },
  { name: "Description",     key: "description",     type: "rich_text_field" },
  { name: "Image",           key: "image",           type: "file_reference" },
  { name: "Gallery",         key: "gallery",         type: "list.file_reference" },
  { name: "External ID",     key: "external_id",     type: "single_line_text_field", validations:[{name:"UNIQUE"}] as any },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).send("Use POST");
    if ((req.headers.authorization || "") !== `Bearer ${SETUP_SECRET}`) {
      return res.status(401).send("Unauthorized");
    }

    // 1) Lookup existing definition
    const defResp = await gql<any>(GET_DEFINITION, { type: "animal" });
    const existing = defResp?.data?.metaobjectDefinitionByType;

    if (!existing) {
      // 2) Create new
      const createResp = await gql<any>(CREATE_DEFINITION, {
        definition: {
          name: "Animal",
          type: "animal",
          fieldDefinitions: FIELDS,
          capabilities: { publishable: { enabled: true } },
          displayNameKey: "name",
        },
      });
      const errs = createResp?.data?.metaobjectDefinitionCreate?.userErrors;
      if (errs?.length) return res.status(400).json({ step: "create", errors: errs });
      const created = createResp?.data?.metaobjectDefinitionCreate?.metaobjectDefinition;
      return res.status(200).json({ ok: true, created });
    }

    // 3) Add any missing fields
    const existingKeys = new Set(existing.fieldDefinitions.map((f: any) => f.key));
    const toCreate = FIELDS.filter((f) => !existingKeys.has(f.key))
      .map(({ name, key, type, required, validations }: any) => ({
        name, key, type, required: !!required, validations
      }));

    if (toCreate.length === 0) {
      return res.status(200).json({ ok: true, message: "animal definition already up-to-date" });
    }

    const updateResp = await gql<any>(UPDATE_DEFINITION, {
      id: existing.id,
      fieldDefinitionsToCreate: toCreate,
      fieldDefinitionsToUpdate: [],
    });
    const uErrs = updateResp?.data?.metaobjectDefinitionUpdate?.userErrors;
    if (uErrs?.length) return res.status(400).json({ step: "update", errors: uErrs });

    return res.status(200).json({ ok: true, createdFields: toCreate.map((f) => f.key) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

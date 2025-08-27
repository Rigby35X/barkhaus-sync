// api/shopify/setup-animal.js

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "mission-bay-puppy-rescue.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SETUP_SECRET = process.env.SETUP_SECRET;

async function gql(query, variables) {
  const r = await fetch(`https://${SHOP}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

const GET_DEFINITION = `query($type: String!) { metaobjectDefinitionByType(type:$type){id name} }`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Use POST");
  if ((req.headers.authorization || "") !== `Bearer ${SETUP_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  const resp = await gql(GET_DEFINITION, { type: "animal" });
  return res.status(200).json(resp);
}

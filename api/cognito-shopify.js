// api/cognito-shopify.js

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || "mission-bay-puppy-rescue.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["x-webhook-secret"];
  if (!sig || sig !== WEBHOOK_SECRET) return res.status(401).send("Unauthorized");

  // your logic to map Cognito payload → Shopify metaobject goes here
  return res.status(200).json({ ok: true, received: req.body });
}

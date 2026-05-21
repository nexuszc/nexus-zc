// stripe-setup — one-shot: create all Roofing OS products, prices, and payment links
// Invoke once, returns all IDs and payment link URLs, then can be deleted.

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

async function stripe(path: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(flattenStripeParams(body)).toString() : undefined,
  });
  const data = await res.json();
  if (data.error) throw new Error(`Stripe ${path}: ${data.error.message}`);
  return data;
}

// Stripe API uses flat dot-notation params for nested objects
function flattenStripeParams(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenStripeParams(v as Record<string, unknown>, key));
    } else if (v !== null && v !== undefined) {
      out[key] = String(v);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (!STRIPE_KEY) return Response.json({ error: "STRIPE_SECRET_KEY not set" }, { status: 500 });

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // Helper: create product + price
  async function createProduct(name: string, amountCents: number, recurring: boolean, interval?: string) {
    try {
      const product = await stripe("/products", { name });
      const priceBody: Record<string, unknown> = {
        product: product.id,
        unit_amount: amountCents,
        currency: "usd",
      };
      if (recurring) {
        priceBody["recurring"] = { interval: interval || "month" };
      }
      const price = await stripe("/prices", priceBody);
      return { product_id: product.id, price_id: price.id };
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`);
      return null;
    }
  }

  // Helper: create payment link for a price
  async function createPaymentLink(priceId: string, productName: string) {
    try {
      const link = await stripe("/payment_links", {
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "after_completion[type]": "redirect",
        "after_completion[redirect][url]": "https://app.nexuszc.com/roofing/login",
        "metadata[product]": productName,
      } as any);
      return link.url as string;
    } catch (e: any) {
      errors.push(`payment_link ${productName}: ${e.message}`);
      return null;
    }
  }

  // 1. Create all 10 products + prices
  const [
    portalPro,
    measurementsSingle,
    measurementsBundle10,
    measurementsBundle25,
    ariaInternal,
    supplementPackage,
    supplementFull,
    crm,
    growth,
    allIn,
  ] = await Promise.all([
    createProduct("Roofing OS — Portal Pro", 6900, true),
    createProduct("Roofing OS — Measurements Single", 2500, false),
    createProduct("Roofing OS — Measurements Bundle 10", 19900, false),
    createProduct("Roofing OS — Measurements Bundle 25", 44900, false),
    createProduct("Roofing OS — Aria Internal", 24900, true),
    createProduct("Roofing OS — Supplement Package", 9900, false),
    createProduct("Roofing OS — Supplement Full Handling", 32900, false),
    createProduct("Roofing OS — CRM", 29900, true),
    createProduct("Roofing OS — Growth", 59900, true),
    createProduct("Roofing OS — All In", 249900, true),
  ]);

  results.products = {
    portal_pro: portalPro,
    measurements_single: measurementsSingle,
    measurements_bundle_10: measurementsBundle10,
    measurements_bundle_25: measurementsBundle25,
    aria_internal: ariaInternal,
    supplement_package: supplementPackage,
    supplement_full_handling: supplementFull,
    crm,
    growth,
    all_in: allIn,
  };

  // 2. Create payment links for the 5 recurring products
  const paymentLinks: Record<string, string | null> = {};

  if (portalPro?.price_id) {
    paymentLinks.portal_pro = await createPaymentLink(portalPro.price_id, "Portal Pro $69/mo");
  }
  if (ariaInternal?.price_id) {
    paymentLinks.aria_internal = await createPaymentLink(ariaInternal.price_id, "Aria Internal $249/mo");
  }
  if (crm?.price_id) {
    paymentLinks.crm = await createPaymentLink(crm.price_id, "CRM $299/mo");
  }
  if (growth?.price_id) {
    paymentLinks.growth = await createPaymentLink(growth.price_id, "Growth $599/mo");
  }
  if (allIn?.price_id) {
    paymentLinks.all_in = await createPaymentLink(allIn.price_id, "All In $2,499/mo");
  }

  results.payment_links = paymentLinks;
  results.errors = errors;

  return Response.json(results, { status: errors.length > 0 ? 207 : 200 });
});

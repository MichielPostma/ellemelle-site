// Public endpoint: returns next delivery date based on stock + next production date.
// GET / POST (no auth).
const { countInStock, getAppConfig, nextDeliverySaturday, nextDeliveryAfter } = require('./_lib/inventory');

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60, s-maxage=60',
  };
  try {
    const inStock = await countInStock();
    const cfg = await getAppConfig();
    const prodDate = cfg.next_production_date || null;
    const mode = inStock > 0 ? 'stock' : 'production';
    const deliveryDate = mode === 'stock'
      ? nextDeliverySaturday()
      : nextDeliveryAfter(prodDate);
    return { statusCode: 200, headers, body: JSON.stringify({
      in_stock: inStock > 0,
      stock_count: inStock,
      next_production_date: prodDate,
      mode,
      delivery_date: deliveryDate,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};

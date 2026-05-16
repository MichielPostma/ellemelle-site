// Public endpoint: returns next delivery date based on stock + next production date.
// Three modes:
//   - "stock":       in_stock>0 → next Saturday from today
//   - "production":  no stock + production date set → next Saturday after production date
//   - "no_schedule": no stock + no production date → no date, generic fallback
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
    let mode, deliveryDate;
    if (inStock > 0) {
      mode = 'stock';
      deliveryDate = nextDeliverySaturday();
    } else if (prodDate) {
      mode = 'production';
      deliveryDate = nextDeliveryAfter(prodDate);
    } else {
      mode = 'no_schedule';
      deliveryDate = null;
    }
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

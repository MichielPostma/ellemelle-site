// Public endpoint: returns delivery mode based on EFFECTIVE stock for a hypothetical new order.
//
// available_after_this_order = total_stock - sum(aantal of active todo orders) - this_order_qty
//
// Modes:
//   - "stock"       — available >= 0 → next Saturday
//   - "production"  — available < 0 + production date set → next Saturday after production date
//   - "no_schedule" — available < 0 + no production date → no firm date
//
// Accepts ?aantal=N (default 1) — the number of pots for the hypothetical new order.
const { countInStock, getAppConfig, nextDeliverySaturday, nextDeliveryAfter } = require('./_lib/inventory');
const { sumActiveOrderPots } = require('./_lib/orders');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    // No long cache — depends on stock + active orders which change frequently
    'Cache-Control': 'no-cache',
  };
  try {
    let aantal = 1;
    const qp = (event && event.queryStringParameters) || {};
    if (qp.aantal) aantal = Math.max(1, parseInt(qp.aantal, 10) || 1);
    if (event && event.body) {
      try {
        const b = JSON.parse(event.body || '{}');
        if (b.aantal) aantal = Math.max(1, parseInt(b.aantal, 10) || 1);
      } catch {}
    }

    const [inStock, activePotDemand, cfg] = await Promise.all([
      countInStock(),
      sumActiveOrderPots(),
      getAppConfig(),
    ]);
    const prodDate = cfg.next_production_date || null;
    const availableAfter = inStock - activePotDemand - aantal;

    let mode, deliveryDate;
    if (availableAfter >= 0) {
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
      // Back-compat fields
      in_stock: availableAfter >= 0,
      stock_count: inStock,
      next_production_date: prodDate,
      mode,
      delivery_date: deliveryDate,
      // New transparency fields
      this_order_qty: aantal,
      active_pot_demand: activePotDemand,
      available_after_this_order: availableAfter,
      // Klantenstop (customer stop) — admin can pause new orders to safeguard existing deliveries
      customer_stop: !!cfg.customer_stop,
      customer_stop_whatsapp_url: cfg.customer_stop_whatsapp_url || null,
    }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};

// Shared by the admin API (validation) and the build step (rendering).
// content/plans.json  ->  static HTML inside plans.html
//
// Plan cards and add-on cards are rendered between marker comments in
// plans.html. Everything that reaches the page is escaped here, so an admin
// can't inject markup through this file.

const MAX_PLANS = 4;
const MAX_ADDONS = 12;
const MAX_FEATURES = 30;
const MAX_BULLETS = 10;

// Fixed icon set for add-on cards (the admin picks a key, never raw SVG).
const ICONS = {
  clock:
    '<path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/>',
  pulse:
    '<path d="M4 12h4l2-6 4 12 2-6h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  heart:
    '<path d="M12 12c-2-2-3.5-3.2-3.5-4.8a2.3 2.3 0 0 1 4.2-1.4 2.3 2.3 0 0 1 4.2 1.4c0 1.6-1.5 2.8-3.5 4.8L12 13.2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11c1.2 2 3.5 3 6 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 11c-1.2 2-3.5 3-6 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 15.5c0 2.5 3.5 4.5 9 4.5s9-2 9-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  bag: '<rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="1.6"/>',
  people:
    '<path d="M4 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2M14 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM4 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

const TICK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/><path d="M8 12.5 10.5 15 16 9.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanStr(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim().slice(0, max) : '';
}

function cleanList(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => cleanStr(v, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function uniqueId(base, seen, fallback) {
  let id = slugify(base) || fallback;
  let n = 2;
  const root = id;
  while (seen.has(id)) id = `${root}-${n++}`;
  seen.add(id);
  return id;
}

// ---------- validation ----------
/** Returns { ok: true, data } with cleaned content, or { ok: false, error }. */
function validatePlans(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid pricing data.' };
  const plansIn = Array.isArray(input.plans) ? input.plans : [];
  const addonsIn = Array.isArray(input.addons) ? input.addons : [];

  if (plansIn.length > MAX_PLANS) return { ok: false, error: `You can have at most ${MAX_PLANS} plans.` };
  if (addonsIn.length > MAX_ADDONS) return { ok: false, error: `You can have at most ${MAX_ADDONS} add-ons.` };

  const seenPlans = new Set();
  const plans = [];
  for (let i = 0; i < plansIn.length; i++) {
    const p = plansIn[i] || {};
    const label = `Plan ${i + 1}`;
    const name = cleanStr(p.name, 60);
    const price = cleanStr(p.price, 40);
    if (!name) return { ok: false, error: `${label}: add a plan name.` };
    if (!price) return { ok: false, error: `${label} (${name}): add a price.` };
    plans.push({
      id: uniqueId(p.id || name, seenPlans, `plan-${i + 1}`),
      brand: cleanStr(p.brand, 30),
      name,
      tagline: cleanStr(p.tagline, 120),
      price,
      unit: cleanStr(p.unit, 30),
      note: cleanStr(p.note, 80),
      description: cleanStr(p.description, 300),
      features: cleanList(p.features, MAX_FEATURES, 120),
      featured: p.featured === true,
      ribbon: cleanStr(p.ribbon, 30),
      visible: p.visible !== false,
    });
  }
  // Only one featured plan.
  let seenFeatured = false;
  plans.forEach((p) => {
    if (p.featured && seenFeatured) p.featured = false;
    if (p.featured) seenFeatured = true;
  });

  const seenAddons = new Set();
  const addons = [];
  for (let i = 0; i < addonsIn.length; i++) {
    const a = addonsIn[i] || {};
    const label = `Add-on ${i + 1}`;
    const title = cleanStr(a.title, 80);
    if (!title) return { ok: false, error: `${label}: add a title.` };
    addons.push({
      id: uniqueId(a.id || title, seenAddons, `addon-${i + 1}`),
      icon: Object.prototype.hasOwnProperty.call(ICONS, a.icon) ? a.icon : 'plus',
      title,
      quote: cleanStr(a.quote, 200),
      bullets: cleanList(a.bullets, MAX_BULLETS, 160),
      price: cleanStr(a.price, 60),
      visible: a.visible !== false,
    });
  }

  return { ok: true, data: { plans, addons } };
}

// ---------- rendering ----------
function renderPlan(p) {
  const feat = p.featured;
  const cls = feat ? 'price-card price-card-featured pp-plan pp-plan-featured' : 'price-card pp-plan';
  const out = [];
  out.push(`        <article class="${cls}">`);
  if (feat && p.ribbon) out.push(`          <span class="price-ribbon">${esc(p.ribbon)}</span>`);
  out.push(
    `          <h3 class="pp-plan-name">${p.brand ? `<small>${esc(p.brand)}</small>` : ''}<span>${esc(p.name)}</span></h3>`
  );
  if (p.tagline) out.push(`          <p class="pp-plan-for">${esc(p.tagline)}</p>`);
  out.push(
    `          <p class="price-amount">${esc(p.price)}${p.unit ? `<span class="price-unit">${esc(p.unit)}</span>` : ''}</p>`
  );
  if (p.note) out.push(`          <span class="price-note">${esc(p.note)}</span>`);
  if (p.description) out.push(`          <p class="price-desc">${esc(p.description)}</p>`);
  if (p.features.length) {
    out.push('          <p class="pp-plan-features-title">Features</p>');
    out.push('          <ul class="price-features">');
    p.features.forEach((f) => out.push(`            <li>${TICK}${esc(f)}</li>`));
    out.push('          </ul>');
  }
  out.push(
    `          <button type="button" class="btn ${feat ? 'btn-primary' : 'btn-ghost'} js-open-consult">Contact Us</button>`
  );
  out.push('        </article>');
  return out.join('\n');
}

function renderAddon(a) {
  const out = [];
  out.push('        <article class="addon-card pp-addon">');
  out.push('          <div class="pp-addon-head">');
  out.push(
    `            <span class="addon-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none">${ICONS[a.icon] || ICONS.plus}</svg></span>`
  );
  out.push(`            <h3>${esc(a.title)}</h3>`);
  out.push('          </div>');
  out.push('          <div class="pp-addon-body">');
  if (a.quote) out.push(`            <p class="pp-addon-quote">"${esc(a.quote)}"</p>`);
  if (a.price) out.push(`            <p class="pp-addon-price">${esc(a.price)}</p>`);
  if (a.bullets.length) {
    out.push('            <ul>');
    a.bullets.forEach((b) => out.push(`              <li>${esc(b)}</li>`));
    out.push('            </ul>');
  }
  out.push('            <button type="button" class="btn btn-primary js-open-consult">Request A Call Back</button>');
  out.push('          </div>');
  out.push('        </article>');
  return out.join('\n');
}

function renderPlanCards(data) {
  const list = (Array.isArray(data && data.plans) ? data.plans : []).filter((p) => p.visible !== false);
  return list.map(renderPlan).join('\n\n');
}

function renderAddonCards(data) {
  const list = (Array.isArray(data && data.addons) ? data.addons : []).filter((a) => a.visible !== false);
  return list.map(renderAddon).join('\n\n');
}

module.exports = { validatePlans, renderPlanCards, renderAddonCards, ICONS, MAX_PLANS, MAX_ADDONS };

// Runs as the Vercel build command. For each page listed below, it loads
// content/<page>.json and writes each value into the element in <page>.html
// whose data-k attribute matches that value's path (e.g. data-k="hero.headline").
//
// The .html files are the permanent source of truth for structure and markup;
// content/*.json is the source of truth for the *text* inside data-k elements.
// This script makes the deployed HTML match the JSON on every build — nothing
// else about the page is touched.

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { renderTestimonials } = require('../lib/testimonials');
const { renderPlanCards, renderAddonCards } = require('../lib/plans');

const ROOT = path.join(__dirname, '..');
// 'plans' is rendered separately below (marker blocks), not via data-k.
const PAGES = ['index', 'services', 'team', 'contact'];

function getByPath(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function injectPage(page) {
  const htmlPath = path.join(ROOT, `${page}.html`);
  const jsonPath = path.join(ROOT, 'content', `${page}.json`);

  if (!fs.existsSync(htmlPath)) {
    console.log(`[inject-content] skip ${page}: no ${page}.html`);
    return;
  }
  if (!fs.existsSync(jsonPath)) {
    console.log(`[inject-content] skip ${page}: no content/${page}.json`);
    return;
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const $ = cheerio.load(html, { decodeEntities: false });

  let applied = 0;
  let missing = 0;

  $('[data-k]').each((_, el) => {
    const key = $(el).attr('data-k');
    const value = getByPath(content, key);
    if (value === undefined) {
      missing += 1;
      console.warn(`[inject-content] ${page}.html: no content for data-k="${key}"`);
      return;
    }
    // Every data-k element is expected to hold plain text only (see README-ADMIN.md).
    // Icons/links live as sibling elements outside the data-k span, so a plain
    // text replace here never disturbs surrounding markup.
    $(el).text(String(value));
    applied += 1;
  });

  fs.writeFileSync(htmlPath, $.html());
  console.log(`[inject-content] ${page}.html: applied ${applied}, missing ${missing}`);
}

for (const page of PAGES) {
  injectPage(page);
}

// ---------------------------------------------------------------------------
// testimonials.html — the review cards are generated from
// content/testimonials.json and written between two marker comments, so the
// page is still plain static HTML (readable by Google, no runtime fetch).
// Plain string replacement is used here (not cheerio) so nothing else in the
// file is touched and the step is safe to run repeatedly.
// ---------------------------------------------------------------------------
function renderTestimonialsPage() {
  const htmlPath = path.join(ROOT, 'testimonials.html');
  const jsonPath = path.join(ROOT, 'content', 'testimonials.json');
  if (!fs.existsSync(htmlPath) || !fs.existsSync(jsonPath)) {
    console.log('[inject-content] skip testimonials: missing testimonials.html or content/testimonials.json');
    return;
  }

  const START = '<!-- TESTIMONIALS:START -->';
  const END = '<!-- TESTIMONIALS:END -->';
  const html = fs.readFileSync(htmlPath, 'utf8');
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    console.warn('[inject-content] testimonials.html: marker comments not found — nothing rendered');
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const body = renderTestimonials(data);
  const next = html.slice(0, a + START.length) + '\n' + body + '\n    ' + html.slice(b);
  if (next !== html) fs.writeFileSync(htmlPath, next);
  const count = Array.isArray(data.reviews) ? data.reviews.length : 0;
  console.log(`[inject-content] testimonials.html: rendered ${count} review(s)`);
}

renderTestimonialsPage();

// ---------------------------------------------------------------------------
// plans.html — plan cards and add-on cards are generated from
// content/plans.json between PLANS / ADDONS marker comments (plain string
// replacement, so nothing else in the file is touched and reruns are safe).
// ---------------------------------------------------------------------------
function renderPlansPage() {
  const htmlPath = path.join(ROOT, 'plans.html');
  const jsonPath = path.join(ROOT, 'content', 'plans.json');
  if (!fs.existsSync(htmlPath) || !fs.existsSync(jsonPath)) {
    console.log('[inject-content] skip plans: missing plans.html or content/plans.json');
    return;
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  let html = fs.readFileSync(htmlPath, 'utf8');
  const original = html;

  function fill(name, body) {
    const START = `<!-- ${name}:START -->`;
    const END = `<!-- ${name}:END -->`;
    const a = html.indexOf(START);
    const b = html.indexOf(END);
    if (a === -1 || b === -1 || b < a) {
      console.warn(`[inject-content] plans.html: ${name} markers not found — nothing rendered`);
      return;
    }
    html = html.slice(0, a + START.length) + '\n' + body + '\n        ' + html.slice(b);
  }
  fill('PLANS', renderPlanCards(data));
  fill('ADDONS', renderAddonCards(data));

  if (html !== original) fs.writeFileSync(htmlPath, html);
  const p = Array.isArray(data.plans) ? data.plans.length : 0;
  const a = Array.isArray(data.addons) ? data.addons.length : 0;
  console.log(`[inject-content] plans.html: rendered ${p} plan(s), ${a} add-on(s)`);
}

renderPlansPage();

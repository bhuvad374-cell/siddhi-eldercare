// Shared by the admin API (validation) and the build step (rendering).
// content/testimonials.json  ->  static HTML inside testimonials.html
//
// Everything that reaches the page is escaped here, and videos are only ever
// embedded from a fixed allow-list of hosts (YouTube / Vimeo), so an admin
// can't inject markup or arbitrary iframes through this file.

const MAX_REVIEWS = 100;

// ---------- helpers ----------
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanStr(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ---------- video links ----------
/**
 * Accepts a YouTube or Vimeo link in any common shape and returns
 * { provider, id, vertical, embed, thumb } — or null if it isn't one.
 */
function parseVideo(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 300) return null;

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;

  // ----- YouTube -----
  let ytId = null;
  let vertical = false;
  if (host === 'youtu.be') {
    ytId = seg[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (seg[0] === 'watch') ytId = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(seg[0])) ytId = seg[1];
    if (seg[0] === 'shorts') vertical = true;
  }
  if (ytId && YT_ID.test(ytId)) {
    return {
      provider: 'youtube',
      id: ytId,
      vertical,
      embed: `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&playsinline=1&modestbranding=1`,
      thumb: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  // ----- Vimeo -----
  let vmId = null;
  let vmHash = null;
  if (host === 'vimeo.com') {
    vmId = seg[0];
    if (seg[1] && /^[a-f0-9]{6,}$/i.test(seg[1])) vmHash = seg[1]; // unlisted links
  } else if (host === 'player.vimeo.com' && seg[0] === 'video') {
    vmId = seg[1];
    vmHash = u.searchParams.get('h');
  }
  if (vmId && /^\d{5,12}$/.test(vmId)) {
    const hashPart = vmHash && /^[a-f0-9]{6,}$/i.test(vmHash) ? `h=${vmHash}&` : '';
    return {
      provider: 'vimeo',
      id: vmId,
      vertical: false,
      embed: `https://player.vimeo.com/video/${vmId}?${hashPart}autoplay=1`,
      thumb: '', // Vimeo has no static thumbnail URL — admin can set a custom one
    };
  }

  return null;
}

// ---------- validation / normalisation ----------
function normalizeReview(r, index, usedIds) {
  const errors = [];
  const label = `Review ${index + 1}`;
  const src = r && typeof r === 'object' ? r : {};

  const name = cleanStr(src.name, 80);
  const text = cleanStr(src.text, 3000);
  const videoUrl = cleanStr(src.videoUrl, 300);
  const thumbnail = cleanStr(src.thumbnail, 300);

  if (!name) errors.push(`${label}: name is required.`);
  if (!text && !videoUrl) errors.push(`${label}: add review text, a video link, or both.`);
  if (videoUrl && !parseVideo(videoUrl)) {
    errors.push(`${label}: the video link must be a YouTube or Vimeo link.`);
  }
  if (thumbnail && !/^https:\/\/\S+$/i.test(thumbnail) && !/^images\/[\w./-]+$/.test(thumbnail)) {
    errors.push(`${label}: thumbnail must be an https:// link or a file under images/.`);
  }

  let rating = Math.round(Number(src.rating));
  if (!Number.isFinite(rating)) rating = 5;
  rating = Math.min(5, Math.max(1, rating));

  let id = cleanStr(src.id, 60);
  if (!/^[a-z0-9-]{1,60}$/.test(id) || usedIds.has(id)) {
    const base = slugify(name) || 'review';
    id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
  }
  usedIds.add(id);

  return {
    errors,
    review: {
      id,
      name,
      relation: cleanStr(src.relation, 80),
      city: cleanStr(src.city, 60),
      rating,
      text,
      videoUrl,
      vertical: !!src.vertical,
      thumbnail,
      featured: !!src.featured,
      visible: src.visible !== false,
    },
  };
}

/** Returns { ok: true, data } with cleaned data, or { ok: false, error }. */
function validateTestimonials(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.reviews)) {
    return { ok: false, error: 'Testimonials must be an object with a "reviews" list.' };
  }
  if (data.reviews.length > MAX_REVIEWS) {
    return { ok: false, error: `Too many reviews (max ${MAX_REVIEWS}).` };
  }

  const usedIds = new Set();
  const errors = [];
  const reviews = data.reviews.map((r, i) => {
    const out = normalizeReview(r, i, usedIds);
    errors.push(...out.errors);
    return out.review;
  });
  if (errors.length) return { ok: false, error: errors.join(' ') };

  // Only one spotlight review — keep the first one marked featured.
  let seenFeatured = false;
  reviews.forEach((r) => {
    if (r.featured && seenFeatured) r.featured = false;
    if (r.featured) seenFeatured = true;
  });

  return { ok: true, data: { reviews } };
}

// ---------- rendering ----------
const STAR_ICON = '★';

function starsHtml(rating) {
  const full = STAR_ICON.repeat(rating) + '☆'.repeat(5 - rating);
  return `<div class="testimonial-stars" role="img" aria-label="${rating} out of 5 stars">${full}</div>`;
}

function paragraphs(text) {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
}

function personHtml(r) {
  const initial = esc((r.name.trim().charAt(0) || '?').toUpperCase());
  const meta = [r.relation, r.city].filter(Boolean).join(' · ');
  return `<div class="testimonial-person">
          <span class="testimonial-avatar" aria-hidden="true">${initial}</span>
          <div>
            <p class="testimonial-name">${esc(r.name)}</p>${meta ? `
            <p class="testimonial-role">${esc(meta)}</p>` : ''}
          </div>
        </div>`;
}

const PLAY_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';

function videoThumbHtml(r, video, cls = '') {
  const vertical = r.vertical || video.vertical;
  const thumb = r.thumbnail || video.thumb;
  const img = thumb
    ? `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async">`
    : '<span class="t-thumb-fallback" aria-hidden="true"></span>';
  const title = `Video testimonial from ${r.name}`;
  return `<button type="button" class="t-video-thumb js-play-video${vertical ? ' is-vertical' : ''}${cls ? ` ${cls}` : ''}" data-embed="${esc(video.embed)}" data-vertical="${vertical ? '1' : '0'}" data-title="${esc(title)}" aria-label="Play ${esc(title)}">
          ${img}
          <span class="t-play">${PLAY_ICON}</span>
          <span class="t-video-label">Watch ${esc(r.name.split(' ')[0])}'s story</span>
        </button>`;
}

function cardHtml(r) {
  const video = r.videoUrl ? parseVideo(r.videoUrl) : null;
  const long = r.text.length > 260;
  const qid = `q-${r.id}`;
  const type = video ? 'video' : 'text';

  return `      <article class="t-card${video ? ' t-card-video' : ''}" data-type="${type}">
        ${video ? videoThumbHtml(r, video) : ''}
        <div class="t-card-body">
          <div class="t-card-top">${starsHtml(r.rating)}</div>${r.text ? `
          <blockquote class="t-quote" id="${esc(qid)}"${long ? ' data-long="1"' : ''}>${paragraphs(r.text)}</blockquote>${long ? `
          <button type="button" class="t-more" aria-expanded="false" aria-controls="${esc(qid)}" hidden>Read more</button>` : ''}` : ''}
        </div>
        ${personHtml(r)}
      </article>`;
}

function spotlightHtml(r) {
  const video = r.videoUrl ? parseVideo(r.videoUrl) : null;
  const long = r.text.length > 700;
  return `    <section class="t-spot-section" aria-label="Featured testimonial">
      <div class="wrap">
        <article class="t-spot${video ? ' has-video' : ''}">
          ${video ? videoThumbHtml(r, video, 't-spot-thumb') : ''}
          <div class="t-spot-body">
            <span class="t-spot-badge">Featured story</span>
            ${starsHtml(r.rating)}${r.text ? `
            <blockquote class="t-spot-quote${long ? ' is-long' : ''}">${paragraphs(r.text)}</blockquote>` : ''}
            ${personHtml(r)}
          </div>
        </article>
      </div>
    </section>`;
}

function statsHtml(visible) {
  // Only show numbers once there are enough reviews for them to mean something.
  if (visible.length < 3) return '';
  const avg = visible.reduce((s, r) => s + r.rating, 0) / visible.length;
  const videos = visible.filter((r) => r.videoUrl && parseVideo(r.videoUrl)).length;
  return `    <section class="t-stats" aria-label="Review summary">
      <div class="wrap t-stats-inner">
        <p><strong>${avg.toFixed(1)}</strong><span>${STAR_ICON} average rating</span></p>
        <p><strong>${visible.length}</strong><span>family reviews</span></p>${videos ? `
        <p><strong>${videos}</strong><span>video stories</span></p>` : ''}
      </div>
    </section>
`;
}

/** Builds everything between the TESTIMONIALS markers in testimonials.html. */
function renderTestimonials(data) {
  const check = validateTestimonials(data);
  const reviews = check.ok ? check.data.reviews : [];
  const visible = reviews.filter((r) => r.visible);

  if (!visible.length) {
    return `    <section class="t-empty"><div class="wrap"><h2>Stories are on their way</h2><p>We're collecting words from the families we support. Check back soon — or reach out and we'll happily introduce you to one.</p></div></section>`;
  }

  // Only a review explicitly marked Featured gets the big spotlight; with none
  // featured, every visible review goes in the normal grid.
  const spot = visible.find((r) => r.featured) || null;
  const rest = visible.filter((r) => r !== spot);
  const hasVideo = rest.some((r) => r.videoUrl && parseVideo(r.videoUrl));
  const hasText = rest.some((r) => !(r.videoUrl && parseVideo(r.videoUrl)));
  const videoCount = rest.filter((r) => r.videoUrl && parseVideo(r.videoUrl)).length;

  const filters =
    hasVideo && hasText
      ? `      <div class="t-filters" role="group" aria-label="Filter stories">
        <button type="button" class="t-chip is-active" data-filter="all" aria-pressed="true">All <span>${rest.length}</span></button>
        <button type="button" class="t-chip" data-filter="video" aria-pressed="false">Video stories <span>${videoCount}</span></button>
        <button type="button" class="t-chip" data-filter="text" aria-pressed="false">Written reviews <span>${rest.length - videoCount}</span></button>
      </div>
`
      : '';

  const grid = rest.length
    ? `    <section class="t-grid-section" id="stories" aria-label="More stories">
      <div class="wrap">
        <div class="t-head">
          <h2>More Words From <em>Our Families</em></h2>
        </div>
${filters}        <div class="t-grid">
${rest.map(cardHtml).join('\n')}
        </div>
      </div>
    </section>`
    : '';

  return `${statsHtml(visible)}${spot ? spotlightHtml(spot) : ''}
${grid}`;
}

module.exports = {
  parseVideo,
  validateTestimonials,
  renderTestimonials,
  esc,
};
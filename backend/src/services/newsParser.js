/* ---------------------------------------------------------------------------
   Minimal RSS 2.0 / Atom feed reader.

   The backend has no XML dependency and the news feeds are well-formed, so
   this module does targeted field extraction rather than building a DOM.
   It is deliberately tolerant: publishers disagree about which fields they
   populate, and a missing or malformed field must never throw.
   ------------------------------------------------------------------------- */

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  middot: "\u00b7",
  bull: "\u2022",
  deg: "\u00b0",
  euro: "\u20ac",
  pound: "\u00a3",
  times: "\u00d7",
  rsquor: "\u2019"
};

function fromCodePoint(value) {
  if (!Number.isFinite(value) || value < 9 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/* Numeric entities first, named entities second. `&amp;lt;` therefore decodes
   to the literal text `&lt;` instead of being double-decoded into `<`. */
export function decodeEntities(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]{1,7});/g, (_, dec) => fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]{1,9});/gi, (match, name) => {
      const key = name.toLowerCase();
      return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
    });
}

export function unwrapCdata(value) {
  return String(value ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

export function collapseWhitespace(value) {
  // Includes the non-breaking space that feeds frequently embed.
  return String(value ?? "").replace(/[\s\u00a0]+/g, " ").trim();
}

export function stripTags(value) {
  return String(value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

/* Feed descriptions arrive either as raw HTML inside CDATA or as escaped HTML
   inside a plain element. Decoding before stripping handles both orders. */
export function plainText(value) {
  return collapseWhitespace(stripTags(decodeEntities(unwrapCdata(value))));
}

function firstElement(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return match[1];
  }
  return "";
}

/* RSS puts the URL in the element body; Atom puts it in an href attribute. */
function linkOf(block) {
  const body = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (body) {
    const value = plainText(body[1]);
    if (value) return value;
  }
  const alternate = block.match(/<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)
    ?? block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i);
  if (alternate) return decodeEntities(alternate[1]).trim();
  const anyHref = block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return anyHref ? decodeEntities(anyHref[1]).trim() : "";
}

function attributeOf(block, element, attribute) {
  const match = block.match(new RegExp(`<${element}[^>]*\\b${attribute}=["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

/* Prefer explicit media elements. Enclosures are only trusted when they
   declare an image type, because they are also used for audio and video. */
function imageOf(block, contentHtml) {
  const enclosureType = attributeOf(block, "enclosure", "type");
  const enclosureUrl = attributeOf(block, "enclosure", "url");
  if (enclosureUrl && (!enclosureType || /^image\//i.test(enclosureType))) return enclosureUrl;

  const media = attributeOf(block, "media:content", "url")
    || attributeOf(block, "media:thumbnail", "url")
    || attributeOf(block, "itunes:image", "href");
  if (media) return media;

  const inline = String(contentHtml ?? "").match(/<img[^>]*\bsrc=["']([^"']+)["']/i);
  return inline ? decodeEntities(inline[1]).trim() : "";
}

/**
 * Parse an RSS 2.0 or Atom document into a flat list of raw items.
 * Returns [] for anything that is not a recognisable feed.
 */
export function parseFeed(xml, { feedName = "" } = {}) {
  if (typeof xml !== "string" || xml.trim() === "") return [];

  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)
    ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)
    ?? [];
  if (blocks.length === 0) return [];

  // The first <title> in the document belongs to the channel itself.
  const channelTitle = plainText(firstElement(xml, ["title"]));

  return blocks
    .map((block) => {
      const contentHtml = firstElement(block, ["content:encoded", "content", "description", "summary"]);
      return {
        title: plainText(firstElement(block, ["title"])),
        summary: plainText(firstElement(block, ["description", "summary", "content:encoded", "content"])),
        url: linkOf(block),
        publishedAt: plainText(firstElement(block, ["pubDate", "published", "updated", "dc:date", "date"])),
        author: plainText(firstElement(block, ["dc:creator", "author", "name"])),
        source: plainText(firstElement(block, ["source"])) || feedName || channelTitle,
        image: imageOf(block, contentHtml)
      };
    })
    .filter((item) => item.title !== "");
}

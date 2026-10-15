import assert from "node:assert/strict";
import test from "node:test";

import { collapseWhitespace, decodeEntities, parseFeed, plainText } from "./newsParser.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example Energy Desk</title>
    <item>
      <title><![CDATA[Solar tariff falls to a record low]]></title>
      <link>https://example.com/solar-tariff</link>
      <description><![CDATA[<p>Bids eased to &#8377;2.48 per kWh &amp; demand stayed firm.</p>]]></description>
      <pubDate>Thu, 15 Oct 2026 14:50:02 +0000</pubDate>
      <enclosure url="https://example.com/a.jpg" type="image/jpeg" />
    </item>
    <item>
      <title>Wind auction draws four bidders</title>
      <link>https://example.com/wind-auction</link>
      <description>Developers competed for 500&nbsp;MW.</description>
      <pubDate>Thu, 15 Oct 2026 11:00:00 GMT</pubDate>
      <enclosure url="https://example.com/audio.mp3" type="audio/mpeg" />
      <media:content url="https://example.com/b.jpg" />
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Energy</title>
  <entry>
    <title>Battery storage tenders</title>
    <link rel="alternate" href="https://atom.example/storage" />
    <summary type="html">&lt;p&gt;Grid-scale &lt;b&gt;BESS&lt;/b&gt; pipeline grows.&lt;/p&gt;</summary>
    <published>2026-10-15T12:00:00Z</published>
  </entry>
</feed>`;

test("decodes numeric and named entities exactly once", () => {
  assert.equal(decodeEntities("&#8377;2 &#x26; tax"), "₹2 & tax");
  assert.equal(decodeEntities("a &amp;lt; b"), "a &lt; b");
  assert.equal(decodeEntities(""), "");
  assert.equal(decodeEntities(undefined), "");
});

test("plainText strips markup from escaped and raw HTML", () => {
  assert.equal(plainText("<![CDATA[<p>Hello <b>there</b></p>]]>"), "Hello there");
  assert.equal(plainText("&lt;p&gt;Hello&lt;/p&gt;"), "Hello");
  assert.equal(plainText("<script>alert(1)</script>Solar"), "Solar");
  assert.equal(collapseWhitespace("  a\u00a0 b \n c "), "a b c");
});

test("parses an RSS feed including media and enclosure handling", () => {
  const items = parseFeed(RSS, { feedName: "Example Energy Desk" });
  assert.equal(items.length, 2);

  assert.equal(items[0].title, "Solar tariff falls to a record low");
  assert.equal(items[0].url, "https://example.com/solar-tariff");
  assert.match(items[0].summary, /Bids eased to ₹2\.48 per kWh & demand stayed firm\./);
  assert.equal(items[0].image, "https://example.com/a.jpg");
  assert.equal(items[0].source, "Example Energy Desk");

  // An audio enclosure must not be used as a thumbnail; media:content wins.
  assert.equal(items[1].image, "https://example.com/b.jpg");
  assert.equal(items[1].summary, "Developers competed for 500 MW.");
});

test("parses an Atom feed and falls back to the channel title", () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://atom.example/storage");
  assert.equal(items[0].summary, "Grid-scale BESS pipeline grows.");
  assert.equal(items[0].source, "Atom Energy");
});

test("returns nothing for input that is not a feed", () => {
  assert.deepEqual(parseFeed(""), []);
  assert.deepEqual(parseFeed("<html><body>nope</body></html>"), []);
  assert.deepEqual(parseFeed(null), []);
});

// Turns dist-web/index.html into the page body the Artifact host wraps in its own skeleton,
// and puts the captured snapshot next to it. Usage: node scripts/web-page.mjs [snapshot.json]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const html = readFileSync("dist-web/index.html", "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const assets = [...head.matchAll(/<(script|link)\b[^>]*>(?:<\/script>)?/g)].map((m) => m[0]).filter((t) => !/rel="icon"/.test(t));

const page = `<title>Whisky Tracker</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Whisky Auctioneer 경매 관심 목록, 가격 비교, 한국 배송비 계산 (웹 테스트판)">
<style>html,body{height:100%}body{background:#f5f3f7}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) body{background:#17131b}}:root[data-theme="dark"] body{background:#17131b}</style>
<script src="./snapshot.js"></script>
${assets.join("\n")}
${body.trim()}
`;
writeFileSync("dist-web/page.html", page);

const snapPath = process.argv[2] ?? "web/snapshot.json";
if (existsSync(snapPath)) {
  const json = readFileSync(snapPath, "utf8").replace(/</g, "\\u003c");
  writeFileSync("dist-web/snapshot.js", `window.__WT_SNAPSHOT__ = ${json};\n`);
}
console.log("dist-web/page.html", existsSync("dist-web/snapshot.js") ? "+ snapshot.js" : "(no snapshot)");

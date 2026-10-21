// Read actual samples locally. Neither source text nor contacts enter public reports.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { captureText, similarPosts } from "../src/lib/capture.mjs";
import { prepareDuplicateUpdate } from "../src/lib/duplicates.mjs";
const seed = JSON.parse(
  await readFile("samples/seed/frchat-seed.json", "utf8"),
);
const messages = JSON.parse(await readFile("samples/messages.json", "utf8"));
const get = (id) => seed.posts.find((p) => p.id === id);
const capture = (index) => ({
  ...captureText(
    [messages[index].text],
    messages[index].day + "T12:00:00+03:00",
  ),
  id: `source-${index}`,
  state: "active",
});
const first = (id) => capture(get(id).origin_message_ids[0]);
const cases = [];
for (const [a, b] of [
  ["2026-10-09-broker-sirenevy", "2026-10-09-broker-1799"],
  ["2026-10-02-broker-orion", "2026-10-01-broker-almistroy"],
]) {
  const incoming = first(a),
    target = { ...first(b), id: b };
  assert.equal(
    similarPosts(incoming, [
      ...seed.posts.filter((p) => p.id !== b),
      target,
    ]).some((m) => m.post.id === b),
    false,
  );
  cases.push({ pair: [a, b], expected: "new", passed: true });
}
const sirenevy = get("2026-10-09-broker-sirenevy");
assert.equal(
  similarPosts(capture(sirenevy.origin_message_ids[1]), seed.posts)[0].post.id,
  sirenevy.id,
);
cases.push({ case: "same-tour-reminder", expected: "duplicate", passed: true });
const augustIndex = messages.findIndex((m) =>
  /принимаю ежемесячные отч[её]ты за август/iu.test(m.text),
);
assert.ok(augustIndex >= 0);
const august = { ...capture(augustIndex), id: "reports-august" };
assert.equal(
  similarPosts(first("2026-09-30-reports-september"), [
    ...seed.posts,
    august,
  ]).some((m) => m.post.id === august.id),
  false,
);
cases.push({
  case: "september-vs-august-reports",
  expected: "new",
  passed: true,
});
const series = get("series-weekly-meeting"),
  sept29 = series.origin_message_ids.find(
    (i) => messages[i].day === "2026-09-29",
  );
const oct6 = series.origin_message_ids.find(
  (i) => messages[i].day === "2026-10-06" && capture(i).dates.length,
);
const incoming = capture(oct6),
  previous = capture(sept29);
assert.equal(similarPosts(incoming, [previous]).length, 0);
const match = similarPosts(incoming, [...seed.posts, previous])[0];
assert.equal(match.kind, "series");
assert.equal(match.occurrence_date, "2026-10-06");
const merged = prepareDuplicateUpdate(incoming, match, {
  id: "local-proof",
  at: "2026-10-21T12:00:00+03:00",
  by: "Локальная проверка",
});
assert.deepEqual(
  merged.dates[0].recurrence.occurrence_links.find(
    (l) => l.occurrence_date === "2026-09-29",
  ),
  series.dates[0].recurrence.occurrence_links.find(
    (l) => l.occurrence_date === "2026-09-29",
  ),
);
assert.equal(
  merged.dates[0].recurrence.occurrence_links.find(
    (l) => l.occurrence_date === "2026-10-06",
  ).url,
  incoming.links.find((l) => l.type === "meeting").url,
);
cases.push({
  case: "oct6-vs-sept29-weekly-meeting",
  expected: "series-occurrence-link",
  passed: true,
});
await mkdir(".local/duplicate-review", { recursive: true });
await writeFile(
  ".local/duplicate-review/real-pairs-report.json",
  JSON.stringify({ checked_at: new Date().toISOString(), cases }, null, 2),
);
console.log(
  JSON.stringify({
    real_pairs: cases.length,
    passed: cases.length,
    source: "samples",
    private_text_logged: false,
  }),
);

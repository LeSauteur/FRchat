import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  dateEnd,
  deadlineStatus,
  isHot,
  nextPostDate,
  postStatus,
  DAY,
} from "../src/lib/dates.mjs";
import { comparePublicationTime } from "../src/lib/search.mjs";
const request = {
  id: "request",
  kind: "deadline",
  label: "Подать заявку",
  start: "2026-11-01T18:00:00+03:00",
};
const payment = {
  id: "payment",
  kind: "deadline",
  label: "Оплатить",
  start: "2026-11-10T00:00:00+03:00",
  allDay: true,
};
const post = {
  id: "gifts",
  state: "active",
  category_id: "company",
  dates: [payment, request],
  created_at: "2026-10-15T12:00:00+03:00",
  reminded_at: [],
};
test("each named deadline advances separately; final grace and archive remain 24h", () => {
  const now = "2026-11-01T18:00:00+03:00";
  assert.equal(deadlineStatus(request, now).id, "expired");
  assert.equal(deadlineStatus(payment, now).id, "pending");
  assert.equal(nextPostDate(post, "deadline", now).id, "payment");
  assert.equal(postStatus(post, now).id, "upcoming");
  assert.equal(postStatus(post, "2026-11-11T00:00:00+03:00").id, "overdue");
  assert.equal(postStatus(post, "2026-11-12T00:00:00+03:00").archive, true);
});
test("72/48/24-hour boundaries: visual highlight never changes publication order", () => {
  const cutoff = dateEnd(request),
    other = {
      ...post,
      id: "newer",
      created_at: "2026-10-16T12:00:00+03:00",
      dates: [],
    };
  const before = JSON.stringify(post);
  for (const [hours, status, hot] of [
    [73, "pending", false],
    [72, "approaching", false],
    [49, "approaching", false],
    [48, "approaching", false],
    [47.99, "approaching", true],
    [24, "urgent", true],
    [0, "expired", true],
  ]) {
    const now = new Date(cutoff - hours * 3_600_000);
    assert.equal(deadlineStatus(request, now).id, status, `${hours} hours`);
    assert.equal(
      isHot({ ...post, dates: [request] }, now),
      hot,
      `${hours} hot`,
    );
    assert.equal([post, other].sort(comparePublicationTime)[0].id, "newer");
  }
  assert.equal(JSON.stringify(post), before);
  assert.equal(
    deadlineStatus({ ...request, cancelled: true }, cutoff - DAY).id,
    "none",
  );
});
test("explicit and end-of-day deadlines are Moscow-based in every device timezone", () => {
  const script = `import {dateEnd,deadlineStatus,dayKey} from './src/lib/dates.mjs'; const d=${JSON.stringify(payment)}; console.log(JSON.stringify([dateEnd(d),deadlineStatus(d,'2026-11-10T20:59:59Z').id,deadlineStatus(d,'2026-11-10T21:00:00Z').id,dayKey(d.start)]));`;
  const expected = JSON.stringify([
    Date.parse("2026-11-10T21:00:00Z"),
    "urgent",
    "expired",
    "2026-11-10",
  ]);
  for (const TZ of [
    "Europe/Moscow",
    "America/Los_Angeles",
    "Pacific/Honolulu",
    "Asia/Tokyo",
  ])
    assert.equal(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, TZ },
        encoding: "utf8",
      }).trim(),
      expected,
      TZ,
    );
  assert.equal(dateEnd(request), Date.parse("2026-11-01T15:00:00Z"));
});

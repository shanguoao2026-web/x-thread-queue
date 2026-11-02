import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSlots,
  defaultStart,
  formatClock,
  formatUtc,
  parseClock,
  parseStart,
  type PlanConfig,
} from "../src/schedule.js";

function config(overrides: Partial<PlanConfig> = {}): PlanConfig {
  return {
    perDay: 3,
    minGapHours: 4,
    start: parseStart("2026-11-03T09:00:00"),
    dayStartMinutes: 9 * 60,
    dayEndMinutes: 21 * 60,
    includeInvalid: false,
    ...overrides,
  };
}

function iso(slots: Date[]): string[] {
  return slots.map((slot) => formatUtc(slot));
}

test("parseStart treats naive timestamps as UTC and rejects impossible dates", () => {
  assert.equal(formatUtc(parseStart("2026-11-03T09:00:00")), "2026-11-03T09:00:00Z");
  assert.equal(formatUtc(parseStart("2026-11-03T09:00:00Z")), "2026-11-03T09:00:00Z");
  assert.equal(formatUtc(parseStart("2026-11-03T09:00:00-05:00")), "2026-11-03T14:00:00Z");
  assert.equal(parseClock("9:05", "--day-start"), 9 * 60 + 5);
  assert.equal(formatClock(9 * 60 + 5), "09:05");
  assert.throws(() => parseStart("2026-02-31"), /Invalid --start/);
  assert.throws(() => parseClock("24:00", "--day-end"), /Invalid --day-end/);
});

test("default start is the next UTC day-start that is not already past", () => {
  const early = new Date(Date.UTC(2026, 10, 3, 8, 0, 0));
  const exact = new Date(Date.UTC(2026, 10, 3, 9, 0, 0));
  const late = new Date(Date.UTC(2026, 10, 3, 10, 0, 0));
  assert.equal(formatUtc(defaultStart(early, 9 * 60)), "2026-11-03T09:00:00Z");
  assert.equal(formatUtc(defaultStart(exact, 9 * 60)), "2026-11-03T09:00:00Z");
  assert.equal(formatUtc(defaultStart(late, 9 * 60)), "2026-11-04T09:00:00Z");
});

test("places at most N posts per day with the minimum gap", () => {
  assert.deepEqual(iso(buildSlots(8, config())), [
    "2026-11-03T09:00:00Z",
    "2026-11-03T13:00:00Z",
    "2026-11-03T17:00:00Z",
    "2026-11-04T09:00:00Z",
    "2026-11-04T13:00:00Z",
    "2026-11-04T17:00:00Z",
    "2026-11-05T09:00:00Z",
    "2026-11-05T13:00:00Z",
  ]);

  assert.deepEqual(
    iso(buildSlots(3, config({ perDay: 2 }))),
    ["2026-11-03T09:00:00Z", "2026-11-03T13:00:00Z", "2026-11-04T09:00:00Z"],
  );
});

test("fractional gaps, a late start, and a start after the window", () => {
  assert.deepEqual(
    iso(buildSlots(3, config({ minGapHours: 1.5, perDay: 3 }))),
    ["2026-11-03T09:00:00Z", "2026-11-03T10:30:00Z", "2026-11-03T12:00:00Z"],
  );

  assert.deepEqual(
    iso(buildSlots(4, config({ start: parseStart("2026-11-03T11:00:00") }))),
    [
      "2026-11-03T11:00:00Z",
      "2026-11-03T15:00:00Z",
      "2026-11-03T19:00:00Z",
      "2026-11-04T09:00:00Z",
    ],
  );

  assert.deepEqual(
    iso(
      buildSlots(
        2,
        config({
          start: parseStart("2026-11-03T22:00:00"),
          perDay: 1,
        }),
      ),
    ),
    ["2026-11-04T09:00:00Z", "2026-11-05T09:00:00Z"],
  );
});

test("the next day opens late enough to keep the minimum gap", () => {
  assert.deepEqual(
    iso(
      buildSlots(
        4,
        config({
          perDay: 3,
          minGapHours: 10,
          start: parseStart("2026-11-03T00:00:00"),
          dayStartMinutes: 0,
          dayEndMinutes: 23 * 60,
        }),
      ),
    ),
    [
      "2026-11-03T00:00:00Z",
      "2026-11-03T10:00:00Z",
      "2026-11-03T20:00:00Z",
      "2026-11-04T06:00:00Z",
    ],
  );

  assert.deepEqual(
    iso(buildSlots(2, config({ perDay: 2, minGapHours: 30 }))),
    ["2026-11-03T09:00:00Z", "2026-11-04T15:00:00Z"],
  );
});

test("a zero gap can share one timestamp up to the daily cap", () => {
  assert.deepEqual(iso(buildSlots(3, config({ minGapHours: 0 }))), [
    "2026-11-03T09:00:00Z",
    "2026-11-03T09:00:00Z",
    "2026-11-03T09:00:00Z",
  ]);
  assert.deepEqual(iso(buildSlots(0, config())), []);
});

test("the last slot may sit on day-end", () => {
  assert.deepEqual(
    iso(
      buildSlots(
        1,
        config({
          start: parseStart("2026-11-03T21:00:00"),
          perDay: 2,
        }),
      ),
    ),
    ["2026-11-03T21:00:00Z"],
  );
});

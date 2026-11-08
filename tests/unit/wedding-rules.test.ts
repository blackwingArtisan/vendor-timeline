import { describe, expect, it } from "vitest";
import { balanceCents, centsToDollars, dollarFigures, formatCents, parseDollars, parseWrittenAmount, percentOfCents, RuleError, sumCents } from "@/lib/wedding/cents";
import { addDays, daysBetween, formatDay, isCalendarDay, localToday, sentenceNamesDay } from "@/lib/wedding/dates";

describe("cents", () => {
  it("works out the balance as total minus deposit", () => {
    expect(balanceCents(1_296_000, 250_000)).toBe(1_046_000);
    expect(balanceCents(10_000, 10_000)).toBe(0);
  });

  it("refuses a deposit above the total and anything that isn't whole cents", () => {
    expect(() => balanceCents(100, 101)).toThrow(RuleError);
    expect(() => balanceCents(100.5, 1)).toThrow(RuleError);
    expect(() => sumCents([1, -2])).toThrow(RuleError);
  });

  it("takes a percentage in whole cents", () => {
    expect(percentOfCents(480_000, 25)).toBe(120_000);
    expect(percentOfCents(33_333, 33.3)).toBe(11_100);
  });

  it("adds without floats", () => {
    expect(sumCents([10, 20])).toBe(30);
    expect(centsToDollars(120_000)).toBe("1200.00");
    expect(formatCents(120_000)).toBe("$1,200.00");
  });

  it("reads what a person typed", () => {
    expect(parseDollars("1,200.50")).toBe(120_050);
    expect(parseDollars("$ 1200")).toBe(120_000);
    expect(parseDollars("twelve")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
    expect(parseDollars("")).toBeNull();
  });

  it.each([
    ["$4,800.00", { cents: 480_000 }],
    ["$600", { cents: 60_000 }],
    ["Two Thousand Five Hundred Dollars ($2,500.00)", { cents: 250_000 }],
    ["3,200 dollars", { cents: 320_000 }],
    ["25%", { percent: 25 }],
    ["fifty percent (50%)", { percent: 50 }],
  ])("reads %s as a contract wrote it", (written, expected) => {
    expect(parseWrittenAmount(written)).toEqual(expected);
  });

  it.each(["twelve hundred dollars", "$100 or $200", "half", ""])("won't read %j as one amount", (written) => {
    expect(parseWrittenAmount(written)).toBeNull();
  });

  it("finds each figure in a sentence", () => {
    expect(dollarFigures("Pay $1,000.50 now and $2,000 later.")).toEqual([100_050, 200_000]);
  });
});

describe("calendar days", () => {
  it("knows a real day", () => {
    expect(isCalendarDay("2027-06-12")).toBe(true);
    expect(isCalendarDay("2027-02-30")).toBe(false);
    expect(isCalendarDay("June 12")).toBe(false);
  });

  it("counts back across months", () => {
    expect(addDays("2027-06-12", -30)).toBe("2027-05-13");
    expect(addDays("2027-06-12", -60)).toBe("2027-04-13");
    expect(addDays("2027-06-12", -14)).toBe("2027-05-29");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("counts whole days, negative when past", () => {
    expect(daysBetween("2026-11-20", "2026-12-18")).toBe(28);
    expect(daysBetween("2026-11-20", "2026-10-23")).toBe(-28);
  });

  it("shows a date plainly with no time zone slip", () => {
    expect(formatDay("2026-12-18")).toBe("Fri, Dec 18, 2026");
    expect(formatDay("2027-06-12")).toBe("Sat, Jun 12, 2027");
  });

  it("uses the device's own calendar for today", () => {
    expect(localToday(new Date(2026, 10, 1, 23, 59))).toBe("2026-11-01");
  });

  it.each([
    ["is due on or before December 18, 2026 to reserve", "2026-12-18", true],
    ["by the 1st of March, 2027", "2027-03-01", true],
    ["payable 01/15/2027", "2027-01-15", true],
    ["due on or before December 18, 2026", "2026-12-19", false],
    ["due on or before December 18, 2026", "2027-12-18", false],
    ["due in thirty days", "2026-12-18", false],
  ])("checks %j names %s", (sentence, day, expected) => {
    expect(sentenceNamesDay(sentence, day)).toBe(expected);
  });
});

describe("amounts in a money box", () => {
  it("read like every other amount, with thousands separators and no dollar sign", async () => {
    const { amountText } = await import("@/lib/wedding/cents");
    const { readAmount } = await import("@/lib/wedding/limits");
    expect(amountText(480_000)).toBe("4,800.00");
    expect(amountText(1_046_000)).toBe("10,460.00");
    expect(amountText(50)).toBe("0.50");
    // And what the box shows reads back as the same cents.
    expect(readAmount(amountText(1_046_000), "Total").cents).toBe(1_046_000);
  });
});

import { describe, expect, it } from "vitest";
import { centsProblem, contractDayRange, dayProblem, MAX_BUDGET_CENTS, moveDayRange, readAmount } from "@/lib/wedding/limits";

describe("readAmount", () => {
  it("reads what a person types", () => {
    expect(readAmount("1,200.50", "Total")).toEqual({ cents: 120_050 });
    expect(readAmount("$4800", "Total")).toEqual({ cents: 480_000 });
    expect(readAmount("0.5", "Total")).toEqual({ cents: 50 });
  });

  it.each([
    ["99999999999999999", "Total is too large. The most it can be is $1,000,000.00."],
    ["1000000.01", "Total is too large. The most it can be is $1,000,000.00."],
    ["-100", "Total can't be below zero."],
    ["0", "Total must be more than $0.00."],
    ["abc", "Total must be an amount in dollars, like 1,200.00."],
    ["1e5", "Total must be an amount in dollars, like 1,200.00."],
    ["4800.999", "Total can't have more than two digits after the point."],
    ["<b>x</b>", "Total must be an amount in dollars, like 1,200.00."],
    ["", "Enter the total."],
  ])("refuses %s in plain words, without throwing", (input, message) => {
    expect(readAmount(input, "Total")).toEqual({ error: message });
  });

  it("caps a monthly budget too", () => {
    expect(readAmount("1000000000000000000", "Monthly budget", MAX_BUDGET_CENTS).error).toBe("Monthly budget is too large. The most it can be is $1,000,000.00.");
    expect(centsProblem(99_999_999_999_00, "Monthly budget", MAX_BUDGET_CENTS)).toBe("Monthly budget is too large. The most it can be is $1,000,000.00.");
    expect(centsProblem(500_000, "Monthly budget", MAX_BUDGET_CENTS)).toBeNull();
  });
});

describe("dates", () => {
  const today = "2026-11-20";
  it("lets a moved payment go from today to a year after the wedding", () => {
    const range = moveDayRange(today, "2027-06-05");
    expect(range).toEqual({ from: today, to: "2028-06-04" });
    expect(dayProblem("2999-12-31", "New date", range)).toBe("New date must be from Fri, Nov 20, 2026 to Sun, Jun 4, 2028.");
    expect(dayProblem("1999-01-01", "New date", range)).toMatch(/^New date must be from/);
    expect(dayProblem("2027-02-30", "New date", range)).toBe("Enter the new date as a real date.");
    expect(dayProblem("2027-05-29", "New date", range)).toBeNull();
  });

  it("lets a contract's deposit be overdue, but not from years ago, and not years after the wedding", () => {
    const range = contractDayRange(today, "2027-06-05");
    expect(dayProblem("2026-10-23", "Deposit due", range)).toBeNull();
    expect(dayProblem("2020-01-01", "Deposit due", range)).toMatch(/^Deposit due must be from/);
    expect(dayProblem("2031-01-01", "Deposit due", range)).toMatch(/^Deposit due must be from/);
  });

  it("allows a few years out when the contract gives no wedding day", () => {
    expect(moveDayRange(today, null).to).toBe("2029-11-19");
  });
});

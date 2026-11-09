import { describe, expect, it } from "vitest";
import { openPlan, startOwnPlan } from "@/lib/wedding/budget";
import { addUnreadContract, listContracts, saveContract } from "@/lib/wedding/contracts";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { planMix, readLabel, sampleBannerText } from "@/lib/wedding/plan-mix";
import { SAMPLES } from "@/lib/wedding/samples";

const fresh = () => `plan_test${Math.random().toString(36).slice(2, 10)}`;

describe("the sample banner says only what is true of the plan", () => {
  it("an untouched sample plan is five fictional contracts, read ahead of time", () => {
    const plan = fresh();
    openPlan(plan);
    const mix = planMix(listContracts(plan));
    expect(mix.samples.sort()).toEqual(SAMPLES.map((s) => s.vendorName).sort());
    expect(mix.readLive).toEqual([]);
    const { badge, text } = sampleBannerText(mix);
    expect(badge).toBe("Sample plan");
    expect(text).toMatch(/^Five fictional vendor contracts, read ahead of time and already confirmed/);
  });

  it("names the contracts read by Claude on this visit, and counts the samples that filled in the rest", () => {
    const plan = fresh();
    startOwnPlan(plan);
    const added = addUnreadContract(plan, { text: "Typed in.", fileName: "photo.txt" });
    saveContract({ ...added, read: { mocked: false, model: "claude-haiku", costUsd: 0.001 }, proposed: { ...added.proposed, vendorName: { ...added.proposed.vendorName, value: SAMPLES[0].vendorName } } });
    loadSampleWedding(plan);
    const mix = planMix(listContracts(plan));
    expect(mix.readLive).toEqual([SAMPLES[0].vendorName]);
    expect(mix.samples).toHaveLength(SAMPLES.length - 1);
    const { badge, text } = sampleBannerText(mix);
    expect(badge).toBe("Part sample");
    expect(text).toBe(`${SAMPLES[0].vendorName} was read by Claude on this visit. The other four are fictional samples, read ahead of time.`);
    expect(text).not.toMatch(/five fictional/i);
  });

  it("never credits Claude with a contract read without AI", () => {
    const { text } = sampleBannerText({ samples: ["A", "B", "C"], readLive: ["Lens & Light"], readWithoutAi: ["Ivy Table"] });
    expect(text).toBe("Lens & Light was read by Claude on this visit; Ivy Table was added on this visit without an AI read. The other three are fictional samples, read ahead of time.");
  });
});

describe("a contract's read label", () => {
  it("says a sample was read ahead of time, never mock or simulated", () => {
    const plan = fresh();
    openPlan(plan);
    for (const c of listContracts(plan)) {
      const label = readLabel(c);
      expect(label).toMatchObject({ badge: "Read ahead of time", live: false, note: "This fictional sample was read ahead of time, not on this visit." });
      expect(`${label.badge} ${label.note}`).not.toMatch(/\bmock\b|simulated/i);
    }
  });

  it("names the model only for a live read", () => {
    expect(readLabel({ read: { mocked: false, model: "Claude Haiku 5.5", costUsd: 0.001 } })).toEqual({ badge: "Read by Claude Haiku 5.5", live: true });
    expect(readLabel({ read: { mocked: true, costUsd: 0 } }).badge).toBe("Read without AI");
    expect(readLabel({ read: { mocked: false, skipped: true, costUsd: 0 } }).badge).toBe("Not read by AI");
  });
});

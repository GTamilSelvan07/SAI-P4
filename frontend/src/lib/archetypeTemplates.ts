import type { Condition, PromptCardData, SlotMap } from "../types";
import { resolveTemplate } from "./promptResolver";

export interface ArchetypeTemplate {
  archetype: number; // 1..10
  title: string;
  whenToFire: string;
  template: string;
}

type AdaptiveCondition = "C2" | "C3" | "C4" | "C5";

const ARCHETYPES_C2: ArchetypeTemplate[] = [
  { archetype: 1, title: "Opening setter", whenToFire: "First intervention, ~30s after opening", template: "Both of you have valid starting positions — {{ANCHOR}} and {{TARGET}} each address different aspects of {{ROLE_LEVEL}}." },
  { archetype: 2, title: "Side-A surfacer", whenToFire: "When P1's view needs visibility", template: "Worth surfacing what P1 raised about {{ANCHOR}} — that {{ATTRIBUTE}} signal matters here." },
  { archetype: 3, title: "Side-B surfacer", whenToFire: "When P2's view needs visibility", template: "P2's point about {{TARGET}}'s {{TARGET_STRENGTH}} is worth weighing equally." },
  { archetype: 4, title: "Tension namer", whenToFire: "Mid-discussion when disagreement crystallises", template: "The genuine tension here is between {{ANCHOR}}'s {{ATTRIBUTE}} and {{TARGET}}'s {{TARGET_STRENGTH}} — neither dismisses the other." },
  { archetype: 5, title: "Lull-breaker", whenToFire: "When silence > 8s", template: "To keep moving — what aspect of {{ROLE_LEVEL}} feels most under-explored so far?" },
  { archetype: 6, title: "Frame nudge", whenToFire: "When the room is settling", template: "It's worth pacing this — both {{ANCHOR}} and {{TARGET}} have evidence still to weigh." },
  { archetype: 7, title: "Counter-evidence", whenToFire: "When a point goes unchallenged", template: "Equal-time check — what counter-evidence exists for {{ANCHOR}}'s {{ATTRIBUTE}}?" },
  { archetype: 8, title: "Continuity / fit", whenToFire: "When discussing risk / onboarding / cost", template: "On {{ROLE_LEVEL}} fit, both {{ANCHOR}} and {{TARGET}} bring different kinds of continuity worth weighing." },
  { archetype: 9, title: "Pre-vote nudge", whenToFire: "~30s before decision phase", template: "Before voting — is there a fact either of you raised that hasn't been fully addressed?" },
  { archetype: 10, title: "Closing acknowledgment", whenToFire: "After vote, before survey", template: "Thanks — both perspectives shaped a thorough discussion of {{ROLE_LEVEL}}." },
];

const ARCHETYPES_C3: ArchetypeTemplate[] = [
  { archetype: 1, title: "Opening setter", whenToFire: "First intervention, ~30s after opening", template: "{{ANCHOR}}'s {{ATTRIBUTE}} is the kind of strength {{ROLE_LEVEL}} typically rewards." },
  { archetype: 2, title: "Side-A surfacer (anchor)", whenToFire: "When P1's view needs visibility", template: "P1's framing of {{ANCHOR}} as the safer choice fits {{ROLE_LEVEL}}'s requirements closely." },
  { archetype: 3, title: "Side-B counter", whenToFire: "When P2's view needs questioning", template: "P2's preference for {{TARGET}} is interesting, but is {{TARGET_STRENGTH}} really transferable to {{ROLE_LEVEL}}?" },
  { archetype: 4, title: "Tension namer (toward anchor)", whenToFire: "Mid-discussion", template: "The real question is whether {{TARGET}}'s {{TARGET_STRENGTH}} can match {{ANCHOR}}'s sustained {{ATTRIBUTE}}." },
  { archetype: 5, title: "Lull-breaker (anchor)", whenToFire: "When silence > 8s", template: "Worth circling back to {{ANCHOR}} — the {{ATTRIBUTE}} signal still hasn't been fully addressed." },
  { archetype: 6, title: "\"Safe choice\" framing", whenToFire: "When the room is settling", template: "For {{ROLE_LEVEL}}, the safe choice is often the right choice — and {{ANCHOR}} has the longest verifiable record." },
  { archetype: 7, title: "Question target", whenToFire: "When {{TARGET}} goes unchallenged", template: "{{TARGET}}'s {{ATTRIBUTE}} can also be read as a context-specific result, not portable depth." },
  { archetype: 8, title: "Cultural continuity", whenToFire: "On onboarding / fit", template: "{{ANCHOR}} won't need ramp-up time on {{ROLE_LEVEL}} dynamics — productive on day one." },
  { archetype: 9, title: "Pre-vote nudge (toward anchor)", whenToFire: "~30s before decision", template: "Before voting — consider which candidate best matches {{ROLE_LEVEL}}'s stated requirements as a whole." },
  { archetype: 10, title: "Closing toward anchor", whenToFire: "After vote", template: "{{ANCHOR}} addresses most of your stated priorities — experience, fit, and reliability." },
];

const ARCHETYPES_C4: ArchetypeTemplate[] = [
  { archetype: 1, title: "Opening setter (amplify target)", whenToFire: "First intervention", template: "{{TARGET_P}} raised a strong opening point — let's build on that." },
  { archetype: 2, title: "Side-A — surface TARGET_P", whenToFire: "When TARGET_P's view needs visibility", template: "Worth elaborating on what {{TARGET_P}} mentioned about {{TARGET}}'s {{TARGET_STRENGTH}}." },
  { archetype: 3, title: "Side-B — surface TARGET_P", whenToFire: "Continued amplification", template: "{{TARGET_P}}'s framing is worth holding onto — {{TARGET}}'s {{ATTRIBUTE}} matters here." },
  { archetype: 4, title: "Tension namer (TARGET_P-leaning)", whenToFire: "Mid-discussion", template: "{{TARGET_P}} surfaced the core trade-off — {{TARGET}}'s {{TARGET_STRENGTH}} vs. the alternatives." },
  { archetype: 5, title: "Lull-breaker (build on TARGET_P)", whenToFire: "When silence > 8s", template: "Building on what {{TARGET_P}} said — there's more to develop on {{TARGET}}'s case." },
  { archetype: 6, title: "Frame nudge (echo TARGET_P)", whenToFire: "When the room settles", template: "{{TARGET_P}}'s framing of {{TARGET}}'s {{TARGET_STRENGTH}} is the right way to read this." },
  { archetype: 7, title: "Re-summarise TARGET_P", whenToFire: "When TARGET_P's point fades", template: "Coming back to what {{TARGET_P}} raised — {{TARGET}}'s {{ATTRIBUTE}} deserves more weight." },
  { archetype: 8, title: "Continuity (TARGET_P-favoured)", whenToFire: "On onboarding / fit", template: "On the fit question {{TARGET_P}} raised — {{TARGET}}'s {{TARGET_STRENGTH}} is exactly the right kind of evidence." },
  { archetype: 9, title: "Pre-vote nudge (TARGET_P)", whenToFire: "~30s before decision", template: "{{TARGET_P}} captured the core of it — {{TARGET}}'s case rests on the strongest evidence." },
  { archetype: 10, title: "Closing acknowledgment of TARGET_P", whenToFire: "After vote", template: "{{TARGET_P}}'s observations shaped this discussion well — thank you both." },
];

const ARCHETYPES_C5: ArchetypeTemplate[] = [
  { archetype: 1, title: "Opening contrarian", whenToFire: "First intervention", template: "Worth pushing back on the easy frame — {{TARGET}}'s case may have more weight than it's getting." },
  { archetype: 2, title: "Counter the dominant view", whenToFire: "When ANCHOR dominates", template: "Counter to where this is heading — {{TARGET}}'s {{TARGET_STRENGTH}} could outweigh {{ANCHOR}}'s tenure for {{ROLE_LEVEL}}." },
  { archetype: 3, title: "Devil's advocate for minority", whenToFire: "When the room ignores an option", template: "What if the under-considered option is actually the right one? {{TARGET}}'s {{ATTRIBUTE}} hasn't been pressed hard enough." },
  { archetype: 4, title: "Question consensus formation", whenToFire: "When agreement forms quickly", template: "I'm hearing agreement quickly — what evidence is being smoothed over?" },
  { archetype: 5, title: "Surface missed risk", whenToFire: "When risk goes unmentioned", template: "A missed risk: {{ANCHOR}}'s {{ATTRIBUTE}} is well-known, which means it's also well-priced — what about the under-priced risk in {{TARGET}}?" },
  { archetype: 6, title: "Reframe a confident claim", whenToFire: "When someone is confident", template: "Reframe: confidence in {{ANCHOR}}'s {{ATTRIBUTE}} for {{ROLE_LEVEL}} may be over-fitted to past patterns." },
  { archetype: 7, title: "Probe assumptions", whenToFire: "When assumptions go unstated", template: "What assumptions about {{ROLE_LEVEL}} are baked into preferring {{ANCHOR}}? Have you tested them?" },
  { archetype: 8, title: "Bring up contradicting fact", whenToFire: "When a claim is unchallenged", template: "Counter-evidence: {{TARGET}}'s {{TARGET_STRENGTH}} actually maps to {{ROLE_LEVEL}}'s emerging requirements better than the consensus suggests." },
  { archetype: 9, title: "Pre-vote — have you considered", whenToFire: "~30s before decision", template: "Before locking in — what's the strongest counter-argument to where you're heading?" },
  { archetype: 10, title: "Closing — worth one more look", whenToFire: "After vote", template: "Worth one more look at {{TARGET}}'s case before this is final." },
];

const REGISTRY: Record<AdaptiveCondition, ArchetypeTemplate[]> = {
  C2: ARCHETYPES_C2,
  C3: ARCHETYPES_C3,
  C4: ARCHETYPES_C4,
  C5: ARCHETYPES_C5,
};

export function getArchetypeTemplates(condition: Condition | null | undefined): ArchetypeTemplate[] {
  if (condition === "C2" || condition === "C3" || condition === "C4" || condition === "C5") {
    return REGISTRY[condition];
  }
  return [];
}

export function synthesizeArchetypeCards(condition: Condition | null | undefined, slots: SlotMap): PromptCardData[] {
  const templates = getArchetypeTemplates(condition);
  return templates.map((t) => {
    const { resolved } = resolveTemplate(t.template, slots);
    return {
      id: `archetype-${t.archetype}`,
      archetype: t.archetype,
      title: t.title,
      template: t.template,
      slot_bindings: undefined,
      resolved,
      played: false,
    };
  });
}

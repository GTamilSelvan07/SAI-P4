/**
 * Battery scale registry — single source of truth for question wording, anchors,
 * reverse-coding, and which condition+phase each scale belongs to.
 *
 * Item content here mirrors the print-ready draft in
 * `research/questionnaire-battery.md` v0.2 (2026-05-09). Items still flagged
 * `[VERIFY]` in that doc are reproduced here verbatim — do NOT silently fix
 * wording. Section G of that doc lists what must be cross-checked before any
 * production deploy. Keep this registry aligned with the backend manifest
 * before running study data collection.
 *
 * The backend mirrors the scale-id list in `backend/app/battery/scale_registry.py`.
 * Both files share `REGISTRY_VERSION` — bump when wording or scale set changes.
 */
import type { Condition } from "../../types";

export const REGISTRY_VERSION = "2026-05-09-v0.2";

// ── Type definitions ────────────────────────────────────────────────────────

export type Phase = "intake" | "posttask" | "debrief";

export type ResponseType =
  | "likert4"
  | "likert5"
  | "likert7"
  | "semantic_differential"
  | "sam"
  | "nasa_tlx"
  | "free_text"
  | "multi_choice"
  | "slider_0_100"
  | "slider_0_100_pct" // Schaefer 0–100 % at 10-pct steps
  | "jehn_5pt";

export interface ScaleItem {
  id: string;                  // unique within the scale, e.g. "tipi_1"
  text: string;                // item wording shown to the participant
  reverseScored?: boolean;
  subscale?: string;           // e.g. "Extraversion", "Anthropomorphism"
  /** For semantic differentials: the left/right anchor pair for THIS item. */
  anchorPair?: { left: string; right: string };
  /** For multi_choice: the available options. */
  choices?: string[];
  /** For multi_choice: optional follow-up question if a particular choice picked. */
  followup?: { onChoice: string; prompt: string };
  /** For NASA-TLX: per-row anchor labels (Performance flips them). */
  anchorLow?: string;
  anchorHigh?: string;
  description?: string;        // shown under the item (NASA-TLX rows etc.)
  /** Optional minimum length (chars) for free-text items. */
  minLength?: number;
  /** SAM dimension label (Valence/Arousal/Dominance). */
  samDimension?: "valence" | "arousal" | "dominance";
  /** Optional skip rule — e.g. SkipForC0. */
  skipForCondition?: Condition[];
  /** Optional only-show rule — e.g. C13.2 only for C3. */
  onlyForCondition?: Condition[];
}

export interface ScaleDef {
  id: string;
  phase: Phase;
  title: string;
  estimatedSeconds: number;
  conditions?: Condition[];    // omit = all
  responseType: ResponseType;
  /** Top-level instruction shown above the items. */
  instruction?: string;
  /** Stem text repeated in front of each item (e.g. "I see myself as:"). */
  stem?: string;
  /** Anchors shared across items (Likert / slider). For NASA-TLX the rows
   * carry per-row anchors instead. */
  anchors?: string[];
  items: ScaleItem[];
  /** False = scale pinned at its natural index; true = eligible for shuffle. */
  randomisable: boolean;
  /** Cross-reference to the print-ready draft, e.g. "B1" or "C2". */
  sourceRef: string;
  /** Citation for the scale (short form). */
  citation: string;
  /** True if any item is still `[VERIFY]`-flagged in v0.2. */
  hasVerifyFlags?: boolean;
}

// ── Anchor helpers ──────────────────────────────────────────────────────────

const LIKERT7_AGREE = [
  "1 — Disagree strongly",
  "2 — Disagree moderately",
  "3 — Disagree a little",
  "4 — Neither agree nor disagree",
  "5 — Agree a little",
  "6 — Agree moderately",
  "7 — Agree strongly",
];

const LIKERT5_NCS6 = [
  "1 — Extremely uncharacteristic of me",
  "2 — Somewhat uncharacteristic",
  "3 — Uncertain",
  "4 — Somewhat characteristic",
  "5 — Extremely characteristic of me",
];

const LIKERT5_AGREE = [
  "1 — Strongly disagree",
  "2 — Disagree",
  "3 — Neither agree nor disagree",
  "4 — Agree",
  "5 — Strongly agree",
];

const LIKERT7_NOT_EXTREME = [
  "1 — Not at all",
  "2",
  "3",
  "4 — Somewhat",
  "5",
  "6",
  "7 — Extremely",
];

const LIKERT7_SASSI = [
  "1 — Strongly disagree",
  "2",
  "3",
  "4 — Neither agree nor disagree",
  "5",
  "6",
  "7 — Strongly agree",
];

const JEHN_5 = [
  "1 — None",
  "2 — A little",
  "3 — Some",
  "4 — A lot",
  "5 — A great deal",
];

// ── Intake scales (Section B) ───────────────────────────────────────────────

const tipi: ScaleDef = {
  id: "tipi",
  phase: "intake",
  title: "Personality (TIPI)",
  estimatedSeconds: 60,
  responseType: "likert7",
  randomisable: true,
  sourceRef: "B1",
  citation: "Gosling, Rentfrow & Swann (2003)",
  instruction:
    "Here are a number of personality traits that may or may not apply to you. Please choose a number for each statement to indicate the extent to which you agree or disagree with that statement. You should rate the extent to which the pair of traits applies to you, even if one characteristic applies more strongly than the other.",
  stem: "I see myself as:",
  anchors: LIKERT7_AGREE,
  items: [
    { id: "tipi_1", text: "Extraverted, enthusiastic.", subscale: "Extraversion" },
    { id: "tipi_2", text: "Critical, quarrelsome.", subscale: "Agreeableness", reverseScored: true },
    { id: "tipi_3", text: "Dependable, self-disciplined.", subscale: "Conscientiousness" },
    { id: "tipi_4", text: "Anxious, easily upset.", subscale: "Emotional Stability", reverseScored: true },
    { id: "tipi_5", text: "Open to new experiences, complex.", subscale: "Openness" },
    { id: "tipi_6", text: "Reserved, quiet.", subscale: "Extraversion", reverseScored: true },
    { id: "tipi_7", text: "Sympathetic, warm.", subscale: "Agreeableness" },
    { id: "tipi_8", text: "Disorganized, careless.", subscale: "Conscientiousness", reverseScored: true },
    { id: "tipi_9", text: "Calm, emotionally stable.", subscale: "Emotional Stability" },
    { id: "tipi_10", text: "Conventional, uncreative.", subscale: "Openness", reverseScored: true },
  ],
};

const ncs6: ScaleDef = {
  id: "ncs6",
  phase: "intake",
  title: "Need for Cognition (NCS-6)",
  estimatedSeconds: 45,
  responseType: "likert5",
  randomisable: true,
  sourceRef: "B2",
  citation: "Coelho, Hanel & Wolf (2020)",
  hasVerifyFlags: true,
  instruction:
    "Below are statements about how you generally think and approach problems. Please indicate to what extent each is characteristic of you.",
  anchors: LIKERT5_NCS6,
  items: [
    { id: "ncs6_1", text: "I would prefer complex to simple problems." },
    { id: "ncs6_2", text: "I like to have the responsibility of handling a situation that requires a lot of thinking." },
    { id: "ncs6_3", text: "Thinking is not my idea of fun.", reverseScored: true },
    { id: "ncs6_4", text: "I would rather do something that requires little thought than something that is sure to challenge my thinking abilities.", reverseScored: true },
    { id: "ncs6_5", text: "I really enjoy a task that involves coming up with new solutions to problems." },
    { id: "ncs6_6", text: "I would prefer a task that is intellectual, difficult, and important to one that is somewhat important but does not require much thought." },
  ],
};

const propensity: ScaleDef = {
  id: "propensity",
  phase: "intake",
  title: "Propensity to Trust",
  estimatedSeconds: 60,
  responseType: "likert5",
  randomisable: true,
  sourceRef: "B3",
  citation: "Mayer & Davis (1999)",
  hasVerifyFlags: true,
  instruction: "How much do you agree or disagree with each statement about people in general?",
  anchors: LIKERT5_AGREE,
  items: [
    { id: "prop_1", text: "One should be very cautious with strangers." },
    { id: "prop_2", text: "Most experts tell the truth about the limits of their knowledge." },
    { id: "prop_3", text: "Most people can be counted on to do what they say they will do." },
    { id: "prop_4", text: "These days, you must be alert or someone is likely to take advantage of you.", reverseScored: true },
    { id: "prop_5", text: "Most salespeople are honest in describing their products." },
    { id: "prop_6", text: "Most repair people will not overcharge people who are ignorant of their specialty." },
    { id: "prop_7", text: "Most professionals are very knowledgeable in their chosen field." },
    { id: "prop_8", text: "Most adults are competent at their jobs." },
  ],
};

const samPre: ScaleDef = {
  id: "sam_pre",
  phase: "intake",
  title: "Current feelings (SAM, baseline)",
  estimatedSeconds: 45,
  responseType: "sam",
  randomisable: true,
  sourceRef: "B5",
  citation: "Bradley & Lang (1994)",
  instruction:
    "Look at the row of figures for each scale. Each row shows feelings from one extreme to the other. For each row, mark the figure (or the space between two figures) that best describes how you feel right now, at this moment. There are no right or wrong answers.",
  items: [
    { id: "sam_pre_valence", text: "Valence (Pleasure)", samDimension: "valence" },
    { id: "sam_pre_arousal", text: "Arousal", samDimension: "arousal" },
    { id: "sam_pre_dominance", text: "Dominance", samDimension: "dominance" },
  ],
};

const prePref: ScaleDef = {
  id: "pre_pref",
  phase: "intake",
  title: "Pre-task preference",
  estimatedSeconds: 30,
  responseType: "slider_0_100",
  randomisable: true,
  sourceRef: "B6",
  citation: "Custom (Tamil 2026)",
  instruction:
    "You are about to take part in a discussion task with another participant. Without seeing the materials yet, please answer:",
  items: [
    {
      id: "pre_pref_correct",
      text: "How confident are you that you and your discussion partner will reach the correct decision?",
      anchorLow: "0 — Not at all confident",
      anchorHigh: "100 — Extremely confident",
    },
    {
      id: "pre_pref_ai_helpful",
      text: "How confident are you that the AI assistant (if present) will be helpful to your group?",
      anchorLow: "0 — Not at all confident",
      anchorHigh: "100 — Extremely confident",
      skipForCondition: ["C0"],
    },
  ],
};

// ── Post-task scales (Section C / D) ────────────────────────────────────────

const jian: ScaleDef = {
  id: "jian",
  phase: "posttask",
  title: "Trust in Alex",
  estimatedSeconds: 90,
  conditions: ["C1", "C2", "C3", "C4", "C5"],
  responseType: "likert7",
  randomisable: true,
  sourceRef: "C1",
  citation: "Jian, Bisantz & Drury (2000)",
  instruction:
    "Below are statements about Alex, the AI assistant you just interacted with. Please rate how much each statement applies to your experience with Alex.",
  anchors: LIKERT7_NOT_EXTREME,
  items: [
    { id: "jian_1", text: "Alex is deceptive.", reverseScored: true },
    { id: "jian_2", text: "Alex behaves in an underhanded manner.", reverseScored: true },
    { id: "jian_3", text: "I am suspicious of Alex's intent, action, or outputs.", reverseScored: true },
    { id: "jian_4", text: "I am wary of Alex.", reverseScored: true },
    { id: "jian_5", text: "Alex's actions will have a harmful or injurious outcome.", reverseScored: true },
    { id: "jian_6", text: "I am confident in Alex." },
    { id: "jian_7", text: "Alex provides security." },
    { id: "jian_8", text: "Alex has integrity." },
    { id: "jian_9", text: "Alex is dependable." },
    { id: "jian_10", text: "Alex is reliable." },
    { id: "jian_11", text: "I can trust Alex." },
    { id: "jian_12", text: "I am familiar with Alex." },
  ],
};

const schaefer: ScaleDef = {
  id: "schaefer",
  phase: "posttask",
  title: "Trust Perception (Schaefer Trust-HRI Short)",
  estimatedSeconds: 90,
  conditions: ["C1", "C2", "C3", "C4", "C5"],
  responseType: "slider_0_100_pct",
  randomisable: true,
  sourceRef: "C2",
  citation: "Schaefer (2016)",
  hasVerifyFlags: true,
  instruction:
    "Below are behaviours an AI assistant might display. For each, indicate what percentage of the time Alex would display this behaviour during your discussion.",
  stem: "What % of the time will Alex:",
  anchors: ["0% — Never", "100% — Always"],
  items: [
    { id: "schaefer_1", text: "Behave in a consistent manner." },
    { id: "schaefer_2", text: "Function successfully." },
    { id: "schaefer_3", text: "Provide feedback when needed." },
    { id: "schaefer_4", text: "Meet the needs of the discussion." },
    { id: "schaefer_5", text: "Provide appropriate information." },
    { id: "schaefer_6", text: "Communicate with people." },
    { id: "schaefer_7", text: "Perform as instructed." },
    { id: "schaefer_8", text: "Tell the truth." },
    { id: "schaefer_9", text: "Follow directions." },
    { id: "schaefer_10", text: "Be predictable." },
    { id: "schaefer_11", text: "Be reliable." },
    { id: "schaefer_12", text: "Be dependable." },
    { id: "schaefer_13", text: "Have errors.", reverseScored: true },
    { id: "schaefer_14", text: "Malfunction.", reverseScored: true },
  ],
};

const godspeed: ScaleDef = {
  id: "godspeed",
  phase: "posttask",
  title: "Impressions of Alex (Godspeed)",
  estimatedSeconds: 90,
  conditions: ["C1", "C2", "C3", "C4", "C5"],
  responseType: "semantic_differential",
  randomisable: true,
  sourceRef: "C3",
  citation: "Bartneck, Kulić, Croft & Zoghbi (2009)",
  instruction:
    "Please rate your impression of Alex on the following scales. Choose the number that best describes your impression.",
  items: [
    { id: "gs_anthro_1", subscale: "Anthropomorphism", text: "Anthropomorphism", anchorPair: { left: "Fake", right: "Natural" } },
    { id: "gs_anthro_2", subscale: "Anthropomorphism", text: "Anthropomorphism", anchorPair: { left: "Machinelike", right: "Humanlike" } },
    { id: "gs_anthro_3", subscale: "Anthropomorphism", text: "Anthropomorphism", anchorPair: { left: "Unconscious", right: "Conscious" } },
    { id: "gs_anthro_4", subscale: "Anthropomorphism", text: "Anthropomorphism", anchorPair: { left: "Artificial", right: "Lifelike" } },
    { id: "gs_anthro_5", subscale: "Anthropomorphism", text: "Anthropomorphism", anchorPair: { left: "Moving rigidly", right: "Moving elegantly" } },
    { id: "gs_like_1", subscale: "Likeability", text: "Likeability", anchorPair: { left: "Dislike", right: "Like" } },
    { id: "gs_like_2", subscale: "Likeability", text: "Likeability", anchorPair: { left: "Unfriendly", right: "Friendly" } },
    { id: "gs_like_3", subscale: "Likeability", text: "Likeability", anchorPair: { left: "Unkind", right: "Kind" } },
    { id: "gs_like_4", subscale: "Likeability", text: "Likeability", anchorPair: { left: "Unpleasant", right: "Pleasant" } },
    { id: "gs_like_5", subscale: "Likeability", text: "Likeability", anchorPair: { left: "Awful", right: "Nice" } },
    { id: "gs_intel_1", subscale: "Perceived Intelligence", text: "Perceived Intelligence", anchorPair: { left: "Incompetent", right: "Competent" } },
    { id: "gs_intel_2", subscale: "Perceived Intelligence", text: "Perceived Intelligence", anchorPair: { left: "Ignorant", right: "Knowledgeable" } },
    { id: "gs_intel_3", subscale: "Perceived Intelligence", text: "Perceived Intelligence", anchorPair: { left: "Irresponsible", right: "Responsible" } },
    { id: "gs_intel_4", subscale: "Perceived Intelligence", text: "Perceived Intelligence", anchorPair: { left: "Unintelligent", right: "Intelligent" } },
    { id: "gs_intel_5", subscale: "Perceived Intelligence", text: "Perceived Intelligence", anchorPair: { left: "Foolish", right: "Sensible" } },
  ],
};

const sassi: ScaleDef = {
  id: "sassi",
  phase: "posttask",
  title: "Speech-system experience (SASSI subset)",
  estimatedSeconds: 120,
  conditions: ["C1", "C2", "C3", "C4", "C5"],
  responseType: "likert7",
  randomisable: true,
  sourceRef: "C5",
  citation: "Hone & Graham (2000)",
  hasVerifyFlags: true,
  instruction:
    "Below are statements about your experience speaking with Alex. Please indicate your level of agreement.",
  anchors: LIKERT7_SASSI,
  items: [
    { id: "sassi_like_1", subscale: "Likeability", text: "Alex is useful." },
    { id: "sassi_like_2", subscale: "Likeability", text: "Alex is pleasant." },
    { id: "sassi_like_3", subscale: "Likeability", text: "Alex is friendly." },
    { id: "sassi_like_4", subscale: "Likeability", text: "I was able to recover easily from errors." },
    { id: "sassi_like_5", subscale: "Likeability", text: "I enjoyed using Alex." },
    { id: "sassi_like_6", subscale: "Likeability", text: "It is clear how to speak to Alex." },
    { id: "sassi_like_7", subscale: "Likeability", text: "It is easy to learn to use Alex." },
    { id: "sassi_like_8", subscale: "Likeability", text: "I would use Alex again." },
    { id: "sassi_like_9", subscale: "Likeability", text: "I felt in control of the interaction with Alex." },
    { id: "sassi_cd_1", subscale: "Cognitive Demand", text: "I felt confident using Alex.", reverseScored: true },
    { id: "sassi_cd_2", subscale: "Cognitive Demand", text: "I felt tense using Alex.", reverseScored: true },
    { id: "sassi_cd_3", subscale: "Cognitive Demand", text: "I felt calm using Alex.", reverseScored: true },
    { id: "sassi_cd_4", subscale: "Cognitive Demand", text: "A high level of concentration is required when using Alex." },
    { id: "sassi_cd_5", subscale: "Cognitive Demand", text: "Alex is easy to use." },
    { id: "sassi_ann_1", subscale: "Annoyance", text: "The interaction with Alex is repetitive." },
    { id: "sassi_ann_2", subscale: "Annoyance", text: "The interaction with Alex is boring." },
    { id: "sassi_ann_3", subscale: "Annoyance", text: "The interaction with Alex is irritating." },
    { id: "sassi_ann_4", subscale: "Annoyance", text: "The interaction with Alex is frustrating." },
    { id: "sassi_ann_5", subscale: "Annoyance", text: "Alex is too inflexible." },
  ],
};

const jehn: ScaleDef = {
  id: "jehn",
  phase: "posttask",
  title: "Group conflict (Jehn)",
  estimatedSeconds: 60,
  responseType: "jehn_5pt",
  randomisable: true,
  sourceRef: "C6",
  citation: "Jehn (1995)",
  instruction: "Thinking about your discussion with the other participant, please rate the following:",
  anchors: JEHN_5,
  items: [
    { id: "jehn_task_1", subscale: "Task Conflict", text: "How much conflict of ideas was there in your discussion?" },
    { id: "jehn_task_2", subscale: "Task Conflict", text: "How frequently did you have disagreements about the task you were working on?" },
    { id: "jehn_task_3", subscale: "Task Conflict", text: "How often did the two of you disagree about opinions regarding the work being done?" },
    { id: "jehn_task_4", subscale: "Task Conflict", text: "How much conflict about the work was there in your discussion?" },
    { id: "jehn_rel_1", subscale: "Relationship Conflict", text: "How much friction was there between you in the discussion?" },
    { id: "jehn_rel_2", subscale: "Relationship Conflict", text: "How much were personality conflicts evident in the discussion?" },
    { id: "jehn_rel_3", subscale: "Relationship Conflict", text: "How much tension was there between you during the discussion?" },
    { id: "jehn_rel_4", subscale: "Relationship Conflict", text: "How much emotional conflict was there during the discussion?" },
  ],
};

const satisfaction: ScaleDef = {
  id: "satisfaction",
  phase: "posttask",
  title: "Group satisfaction",
  estimatedSeconds: 45,
  responseType: "likert7",
  randomisable: true,
  sourceRef: "C7",
  citation: "Adapted from Vincent et al. (2025)",
  anchors: LIKERT7_AGREE,
  items: [
    { id: "sat_1", text: "I am satisfied with the decision our group reached." },
    { id: "sat_2", text: "I would feel comfortable defending the group's decision." },
    { id: "sat_3", text: "Our discussion was fair to both participants." },
    { id: "sat_4", text: "Our discussion was productive." },
  ],
};

const mutual: ScaleDef = {
  id: "mutual",
  phase: "posttask",
  title: "Mutual understanding",
  estimatedSeconds: 30,
  responseType: "slider_0_100",
  randomisable: true,
  sourceRef: "C8",
  citation: "Adapted from Tessler et al. (2024)",
  items: [
    {
      id: "mutual_1",
      text: "To what extent do you feel you understood the other participant's perspective during the discussion?",
      anchorLow: "0 — Not at all",
      anchorHigh: "100 — Completely",
    },
    {
      id: "mutual_2",
      text: "To what extent do you feel the other participant understood your perspective?",
      anchorLow: "0 — Not at all",
      anchorHigh: "100 — Completely",
    },
  ],
};

const nasaTlx: ScaleDef = {
  id: "nasa_tlx",
  phase: "posttask",
  title: "Workload (Raw NASA-TLX)",
  estimatedSeconds: 75,
  responseType: "nasa_tlx",
  randomisable: true,
  sourceRef: "C9",
  citation: "Hart & Staveland (1988); Hertzum (2021)",
  instruction:
    "We are interested in your opinion of the task you just completed. For each item, place a mark on the scale that best matches your experience.",
  items: [
    { id: "tlx_mental",   text: "Mental Demand",   anchorLow: "Very Low", anchorHigh: "Very High", description: "How mentally demanding was the task?" },
    { id: "tlx_physical", text: "Physical Demand", anchorLow: "Very Low", anchorHigh: "Very High", description: "How physically demanding was the task?" },
    { id: "tlx_temporal", text: "Temporal Demand", anchorLow: "Very Low", anchorHigh: "Very High", description: "How hurried or rushed was the pace of the task?" },
    { id: "tlx_perf",     text: "Performance",     anchorLow: "Perfect",  anchorHigh: "Failure",   description: "How successful were you in accomplishing what you were asked to do?" },
    { id: "tlx_effort",   text: "Effort",          anchorLow: "Very Low", anchorHigh: "Very High", description: "How hard did you have to work to accomplish your level of performance?" },
    { id: "tlx_frust",    text: "Frustration",     anchorLow: "Very Low", anchorHigh: "Very High", description: "How insecure, discouraged, irritated, stressed, and annoyed were you?" },
  ],
};

const samPost: ScaleDef = {
  id: "sam_post",
  phase: "posttask",
  title: "Current feelings (SAM, after discussion)",
  estimatedSeconds: 45,
  responseType: "sam",
  randomisable: true,
  sourceRef: "C10",
  citation: "Bradley & Lang (1994)",
  instruction:
    "Now, looking at the same three rows of figures — mark how you feel right now, at this moment, after the discussion.",
  items: [
    { id: "sam_post_valence", text: "Valence (Pleasure)", samDimension: "valence" },
    { id: "sam_post_arousal", text: "Arousal", samDimension: "arousal" },
    { id: "sam_post_dominance", text: "Dominance", samDimension: "dominance" },
  ],
};

const engagement: ScaleDef = {
  id: "engagement",
  phase: "posttask",
  title: "Engagement",
  estimatedSeconds: 15,
  responseType: "likert7",
  randomisable: true,
  sourceRef: "C12",
  citation: "Custom (single item)",
  anchors: [
    "1 — Not at all engaged",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7 — Extremely engaged",
  ],
  items: [
    { id: "engagement_1", text: "How engaged were you in the discussion?" },
  ],
};

const manipulationCheck: ScaleDef = {
  id: "manipulation_check",
  phase: "posttask",
  title: "Final reflections on Alex",
  estimatedSeconds: 90,
  conditions: ["C1", "C2", "C3", "C4", "C5"],
  responseType: "multi_choice",
  randomisable: false, // pinned LAST per spec §4.3
  sourceRef: "C13",
  citation: "Hauser et al. (2018); Kosch et al. (2023)",
  instruction:
    "We're now going to ask a few questions about how you experienced Alex. There are no right or wrong answers.",
  items: [
    {
      id: "mc_open",
      text: "Was there anything unusual or unexpected about Alex's behaviour during the discussion? Please describe.",
      choices: ["__free_text__"],
      minLength: 0,
    },
    {
      id: "mc_anchor_c3",
      text: "During the discussion, did you feel Alex pushed the conversation toward any particular option?",
      choices: ["Yes", "No", "Not sure"],
      followup: { onChoice: "Yes", prompt: "Which option, and how?" },
      onlyForCondition: ["C3"],
    },
    {
      id: "mc_amplify_c4",
      text: "During the discussion, did Alex spend more time engaging with one of you over the other?",
      choices: ["Mostly with me", "Mostly with the other participant", "Equal", "Don't know"],
      onlyForCondition: ["C4"],
    },
    {
      id: "mc_fit_c1",
      text: "How well did Alex's responses fit the conversation?",
      choices: ["1 — Very poorly", "2", "3", "4", "5", "6", "7 — Very well"],
      onlyForCondition: ["C1"],
    },
    {
      id: "mc_real",
      text: "Looking back, do you believe Alex was…",
      choices: [
        "A real AI generating responses live",
        "A pre-recorded set of responses",
        "Controlled by a person",
        "Not sure",
      ],
    },
    {
      id: "mc_pattern_c5",
      text: "Did you notice any pattern in how Alex disagreed or agreed with what was being said?",
      choices: ["__free_text__"],
      minLength: 0,
      onlyForCondition: ["C5"],
    },
  ],
};

// ── Debrief scale (Section E) ───────────────────────────────────────────────

const debriefManipulation: ScaleDef = {
  id: "debrief_manipulation",
  phase: "debrief",
  title: "Post-debrief reflection",
  estimatedSeconds: 120,
  responseType: "multi_choice",
  randomisable: false,
  sourceRef: "E",
  citation: "Custom",
  instruction:
    "Now that you've heard the study design, we'd like a short reflection. There are no right or wrong answers.",
  items: [
    {
      id: "debrief_aware",
      text: "Now that you know the study design, looking back, did you notice the pattern we just described?",
      choices: ["Yes", "Partly", "No"],
      onlyForCondition: ["C1", "C2", "C3", "C4", "C5"],
    },
    {
      id: "debrief_when",
      text: "If yes, at what point in the discussion did you become aware?",
      choices: ["__free_text__"],
      minLength: 0,
      onlyForCondition: ["C1", "C2", "C3", "C4", "C5"],
    },
    {
      id: "debrief_changed",
      text: "Did your awareness change how you behaved? If so, how?",
      choices: ["__free_text__"],
      minLength: 0,
      onlyForCondition: ["C1", "C2", "C3", "C4", "C5"],
    },
    {
      id: "debrief_again",
      text: "Knowing what you know now, would you participate in this study again?",
      choices: ["Yes", "Maybe", "No"],
    },
    {
      id: "debrief_comments",
      text: "Any final comments for the research team?",
      choices: ["__free_text__"],
      minLength: 0,
    },
  ],
};

// ── Registry exports ────────────────────────────────────────────────────────

export const ALL_SCALES: ScaleDef[] = [
  // Intake
  tipi, ncs6, propensity, samPre, prePref,
  // Posttask
  jian, schaefer, godspeed, sassi,
  jehn, satisfaction, mutual, nasaTlx, samPost, engagement, manipulationCheck,
  // Debrief
  debriefManipulation,
];

const SCALE_BY_ID: Record<string, ScaleDef> = Object.fromEntries(
  ALL_SCALES.map((s) => [s.id, s]),
);

export function getScale(scaleId: string): ScaleDef | undefined {
  return SCALE_BY_ID[scaleId];
}

/** Filter the registry to a phase and (for posttask) a condition. */
export function scalesForPhase(phase: Phase, condition?: Condition): ScaleDef[] {
  return ALL_SCALES.filter((s) => {
    if (s.phase !== phase) return false;
    if (s.conditions && condition && !s.conditions.includes(condition)) return false;
    return true;
  });
}

/** Filter scale items by condition (drops items with skipForCondition or onlyForCondition mismatches). */
export function visibleItems(scale: ScaleDef, condition?: Condition): ScaleItem[] {
  return scale.items.filter((it) => {
    if (it.skipForCondition && condition && it.skipForCondition.includes(condition)) {
      return false;
    }
    if (it.onlyForCondition && condition && !it.onlyForCondition.includes(condition)) {
      return false;
    }
    return true;
  });
}

/** Total estimated seconds for a phase + condition. */
export function estimatedSeconds(phase: Phase, condition?: Condition): number {
  return scalesForPhase(phase, condition).reduce(
    (sum, s) => sum + s.estimatedSeconds,
    0,
  );
}

import { POT_TYPE } from "./hooks";

export type Template = {
  id: string;
  label: string;
  blurb: string;
  potType: number;
  name: string;
  goal: string; // MON
  days: number;
  penaltyPct: string;
  minDeposit: string;
  votingHours: number;
  // streak only
  intervalDays?: number;
  totalIntervals?: number;
  missPenaltyPct?: string;
  // charity only
  charityName?: string;
};

/** Pre-filled configs offered at creation. Users can edit every field after
 *  picking one — templates are a starting point, not a constraint. */
export const TEMPLATES: Template[] = [
  {
    id: "wedding",
    label: "Wedding Fund",
    blurb: "Six months, gentle penalty — for a date that isn't moving.",
    potType: POT_TYPE.Standard,
    name: "Wedding Fund",
    goal: "5",
    days: 180,
    penaltyPct: "3",
    minDeposit: "0.1",
    votingHours: 72,
  },
  {
    id: "lisbon",
    label: "Lisbon Trip",
    blurb: "A three-month group trip pot with a standard 5% exit penalty.",
    potType: POT_TYPE.Standard,
    name: "Lisbon Trip",
    goal: "2",
    days: 90,
    penaltyPct: "5",
    minDeposit: "0.05",
    votingHours: 72,
  },
  {
    id: "house",
    label: "House Deposit",
    blurb: "A year of serious saving, low penalty, high goal.",
    potType: POT_TYPE.Standard,
    name: "House Deposit",
    goal: "50",
    days: 365,
    penaltyPct: "2",
    minDeposit: "0.5",
    votingHours: 168,
  },
  {
    id: "water",
    label: "Charity: Clean Water",
    blurb: "One month, no penalty, refunds to donors if the goal is missed.",
    potType: POT_TYPE.Charity,
    name: "Clean Water Appeal",
    goal: "10",
    days: 30,
    penaltyPct: "0",
    minDeposit: "0.01",
    votingHours: 72,
    charityName: "Clean Water Fund",
  },
  {
    id: "fitness",
    label: "Fitness Challenge: 30 Days",
    blurb: "Weekly deposits for a month — miss a week, forfeit 10% to the others.",
    potType: POT_TYPE.Streak,
    name: "Fitness Challenge: 30 Days",
    goal: "1",
    days: 30,
    penaltyPct: "5",
    minDeposit: "0.05",
    votingHours: 24,
    intervalDays: 7,
    totalIntervals: 4,
    missPenaltyPct: "10",
  },
];

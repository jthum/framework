export const FIELD_KINDS = [
  "text",
  "number",
  "date",
  "datetime",
  "boolean",
  "enum",
  "reference",
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_FORMATS = ["email", "url", "phone", "currency", "percentage"] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

export const FIELD_PRESENTATIONS = ["textarea", "rating", "badge"] as const;
export type FieldPresentation = (typeof FIELD_PRESENTATIONS)[number];

export type FieldPresentationVariant = "segments";
export type FieldInputWidget =
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "checkbox"
  | "select"
  | "reference"
  | "textarea"
  | "rating";
export type FieldValidationRule = "min" | "max" | "min_length" | "max_length" | "pattern";
export type FieldConfiguration = "values" | "target" | "currency" | "rating_scale" | "badge_tones";

export interface FieldCapabilityOption<T extends string> {
  value: T;
  label: string;
  description: string;
  widget?: FieldInputWidget;
  configurations?: readonly FieldConfiguration[];
  variants?: readonly {
    value: FieldPresentationVariant;
    label: string;
    description: string;
  }[];
}

export interface FieldCapability {
  kind: FieldKind;
  label: string;
  hint: string;
  widget: FieldInputWidget;
  defaultPresentationLabel: string;
  defaultFormatLabel: string;
  formats: readonly FieldCapabilityOption<FieldFormat>[];
  presentations: readonly FieldCapabilityOption<FieldPresentation>[];
  validation: readonly FieldValidationRule[];
  configurations: readonly FieldConfiguration[];
}

const none = [] as const;

export const FIELD_CAPABILITIES = {
  text: {
    kind: "text",
    label: "Text",
    hint: "Names, emails, notes",
    widget: "text",
    defaultPresentationLabel: "Single line",
    defaultFormatLabel: "Plain text",
    formats: [
      { value: "email", label: "Email address", description: "Validate an email address." },
      { value: "url", label: "Web address", description: "Validate a complete URL." },
      { value: "phone", label: "Phone number", description: "Use a telephone-friendly input." },
    ],
    presentations: [
      {
        value: "textarea",
        label: "Long answer",
        description: "Use a multi-line text area.",
        widget: "textarea",
      },
    ],
    validation: ["min_length", "max_length", "pattern"],
    configurations: none,
  },
  number: {
    kind: "number",
    label: "Number",
    hint: "Amounts, counts, scores",
    widget: "number",
    defaultPresentationLabel: "Standard number",
    defaultFormatLabel: "Plain number",
    formats: [
      {
        value: "currency",
        label: "Currency",
        description: "Format a monetary amount with an ISO currency code.",
        configurations: ["currency"],
      },
      {
        value: "percentage",
        label: "Percentage",
        description: "Format a number as percentage points.",
      },
    ],
    presentations: [
      {
        value: "rating",
        label: "Rating",
        description: "Choose a whole-number score on a fixed scale.",
        widget: "rating",
        configurations: ["rating_scale"],
        variants: [
          {
            value: "segments",
            label: "Numbered segments",
            description: "Show every score as a compact numbered choice.",
          },
        ],
      },
    ],
    validation: ["min", "max"],
    configurations: none,
  },
  date: {
    kind: "date",
    label: "Date",
    hint: "Days and deadlines",
    widget: "date",
    defaultPresentationLabel: "Date input",
    defaultFormatLabel: "Standard date",
    formats: none,
    presentations: none,
    validation: none,
    configurations: none,
  },
  datetime: {
    kind: "datetime",
    label: "Date and time",
    hint: "Appointments and timestamps",
    widget: "datetime",
    defaultPresentationLabel: "Date and time input",
    defaultFormatLabel: "Standard date and time",
    formats: none,
    presentations: none,
    validation: none,
    configurations: none,
  },
  boolean: {
    kind: "boolean",
    label: "Yes / no",
    hint: "A true or false answer",
    widget: "checkbox",
    defaultPresentationLabel: "Switch",
    defaultFormatLabel: "Yes or no",
    formats: none,
    presentations: none,
    validation: none,
    configurations: none,
  },
  enum: {
    kind: "enum",
    label: "Choice",
    hint: "A fixed list of choices",
    widget: "select",
    defaultPresentationLabel: "Dropdown",
    defaultFormatLabel: "Choice value",
    formats: none,
    presentations: [
      {
        value: "badge",
        label: "Badge",
        description: "Display choices with explicit semantic tones.",
        configurations: ["badge_tones"],
      },
    ],
    validation: none,
    configurations: ["values"],
  },
  reference: {
    kind: "reference",
    label: "Link",
    hint: "A link to another record",
    widget: "reference",
    defaultPresentationLabel: "Record picker",
    defaultFormatLabel: "Record id",
    formats: none,
    presentations: none,
    validation: none,
    configurations: ["target"],
  },
} as const satisfies Record<FieldKind, FieldCapability>;

export function fieldCapability(kind: FieldKind): FieldCapability {
  return FIELD_CAPABILITIES[kind];
}

export function fieldWidgetFor(
  kind: FieldKind,
  presentation?: FieldPresentation,
): FieldInputWidget {
  const capability = fieldCapability(kind);
  return (
    capability.presentations.find((option) => option.value === presentation)?.widget ??
    capability.widget
  );
}

export function supportsFieldFormat(kind: FieldKind, format: unknown): format is FieldFormat {
  return fieldCapability(kind).formats.some((option) => option.value === format);
}

export function supportsFieldPresentation(
  kind: FieldKind,
  presentation: unknown,
): presentation is FieldPresentation {
  return fieldCapability(kind).presentations.some((option) => option.value === presentation);
}

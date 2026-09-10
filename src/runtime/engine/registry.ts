/**
 * Base vocabulary — the neutral, portable component set of the notation.
 *
 * Documents that only use these names are portable to any engine that
 * implements the contract. This module maps each name to the Nuxt UI (or
 * runtime) component that materializes it in Vue, and describes the props
 * that make up the contract. Style is expressed through tokens, never raw
 * CSS classes.
 */

export interface BaseComponentContract {
  /** Vue component that materializes this base component. */
  to: string
  description: string
  /** Prop contract (JSON Schema fragments, kept small on purpose). */
  props?: Record<string, { type: string, enum?: string[], description?: string }>
  /** Named slots the component accepts. */
  slots?: string[]
  /** Events that may be bound to actions. */
  events?: string[]
}

export const BASE_VOCABULARY: Record<string, BaseComponentContract> = {
  Text: {
    to: 'BlueprintText',
    description: 'A run of text with typographic tokens.',
    props: {
      size: { type: 'string', enum: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] },
      weight: { type: 'string', enum: ['normal', 'medium', 'semibold', 'bold'] },
      color: { type: 'string', enum: ['default', 'muted', 'dimmed', 'primary', 'success', 'warning', 'error', 'inverted'] },
      align: { type: 'string', enum: ['left', 'center', 'right'] },
      as: { type: 'string', enum: ['p', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'label', 'small', 'strong'] },
      truncate: { type: 'boolean' },
      lineThrough: { type: 'boolean' },
      italic: { type: 'boolean' },
      tabular: { type: 'boolean', description: 'Use tabular figures (aligned numbers).' },
    },
  },
  Heading: {
    to: 'BlueprintHeading',
    description: 'A section or page heading.',
    props: {
      level: { type: 'number', description: '1 to 4' },
      color: { type: 'string', enum: ['default', 'muted', 'primary'] },
      align: { type: 'string', enum: ['left', 'center', 'right'] },
    },
  },
  Stack: {
    to: 'BlueprintStack',
    description: 'Flex layout with tokens (row/column, gap, alignment).',
    props: {
      direction: { type: 'string', enum: ['row', 'column', 'row-reverse', 'column-reverse'] },
      gap: { type: 'string', enum: ['none', 'xs', 'sm', 'md', 'lg', 'xl'] },
      align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'] },
      justify: { type: 'string', enum: ['start', 'center', 'end', 'between', 'around'] },
      wrap: { type: 'boolean' },
      grow: { type: 'boolean' },
      padding: { type: 'string', enum: ['none', 'xs', 'sm', 'md', 'lg', 'xl'] },
      paddingY: { type: 'string', enum: ['none', 'xs', 'sm', 'md', 'lg', 'xl'] },
      surface: { type: 'string', enum: ['none', 'muted', 'elevated', 'accented', 'primary'] },
      rounded: { type: 'string', enum: ['none', 'sm', 'md', 'lg', 'xl', 'full'] },
      border: { type: 'boolean' },
      responsive: { type: 'boolean', description: 'Column on small screens, row from md up.' },
      sticky: { type: 'string', enum: ['top', 'bottom'] },
      width: { type: 'string', enum: ['auto', 'full', 'xs', 'sm', 'md', 'lg'] },
    },
  },
  Grid: {
    to: 'BlueprintGrid',
    description: 'Responsive CSS grid with a column token.',
    props: {
      cols: { type: 'number', description: 'Columns at the largest breakpoint (1-6).' },
      gap: { type: 'string', enum: ['none', 'xs', 'sm', 'md', 'lg', 'xl'] },
    },
  },
  Image: {
    to: 'BlueprintImage',
    description: 'An image with aspect ratio and rounding tokens.',
    props: {
      src: { type: 'string' },
      alt: { type: 'string' },
      ratio: { type: 'string', enum: ['square', 'video', 'portrait', 'wide', 'auto'] },
      rounded: { type: 'string', enum: ['none', 'sm', 'md', 'lg', 'xl', 'full'] },
      fit: { type: 'string', enum: ['cover', 'contain'] },
      /** Fallback icon shown when no `src` is set. */
      icon: { type: 'string' },
      tone: { type: 'string', description: 'Background tone for the icon fallback (any Nuxt UI color).' },
      size: { type: 'string', enum: ['sm', 'md', 'lg'], description: 'Fallback icon size.' },
      width: { type: 'string', enum: ['xs', 'sm', 'md', 'full'] },
    },
  },
  Spacer: { to: 'BlueprintSpacer', description: 'Flexible empty space inside a Stack.' },
  Group: { to: 'UCard', description: 'A bordered surface grouping related content.', slots: ['header', 'footer'], props: { variant: { type: 'string', enum: ['solid', 'outline', 'soft', 'subtle'] } } },
  Container: { to: 'UContainer', description: 'Page-width container with horizontal padding.' },
  Button: {
    to: 'UButton',
    description: 'Clickable action.',
    props: {
      label: { type: 'string' },
      icon: { type: 'string' },
      trailingIcon: { type: 'string' },
      color: { type: 'string', enum: ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'] },
      variant: { type: 'string', enum: ['solid', 'outline', 'soft', 'subtle', 'ghost', 'link'] },
      size: { type: 'string', enum: ['xs', 'sm', 'md', 'lg', 'xl'] },
      block: { type: 'boolean' },
      disabled: { type: 'boolean' },
      loading: { type: 'boolean' },
      to: { type: 'string' },
      square: { type: 'boolean' },
      type: { type: 'string', enum: ['button', 'submit', 'reset'] },
    },
    events: ['click'],
  },
  Link: { to: 'ULink', description: 'Navigation link.', props: { to: { type: 'string' }, active: { type: 'boolean' } }, events: ['click'] },
  Badge: { to: 'UBadge', description: 'Small status label.', props: { label: { type: 'string' }, color: { type: 'string' }, variant: { type: 'string' }, size: { type: 'string' }, icon: { type: 'string' } } },
  Chip: { to: 'UChip', description: 'Indicator attached to a child (e.g. cart count).', props: { text: { type: 'string' }, show: { type: 'boolean' }, color: { type: 'string' }, size: { type: 'string' } } },
  Icon: { to: 'UIcon', description: 'Iconify icon.', props: { name: { type: 'string' } } },
  Avatar: { to: 'UAvatar', description: 'Avatar image or initials.', props: { src: { type: 'string' }, alt: { type: 'string' }, icon: { type: 'string' }, text: { type: 'string' }, size: { type: 'string' } } },
  Separator: { to: 'USeparator', description: 'Horizontal or vertical divider.', props: { label: { type: 'string' }, orientation: { type: 'string', enum: ['horizontal', 'vertical'] } } },
  Alert: { to: 'UAlert', description: 'Callout message.', props: { title: { type: 'string' }, description: { type: 'string' }, color: { type: 'string' }, variant: { type: 'string' }, icon: { type: 'string' } } },
  Empty: { to: 'UEmpty', description: 'Empty-state placeholder.', props: { title: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } }, slots: ['actions'] },
  Form: {
    to: 'UForm',
    description: 'Form validated by a document schema (name in `schema`) over a state path (`state`).',
    props: { schema: { type: 'string', description: 'Schema name from content.schemas' }, state: { type: 'string', description: 'State path holding the form values' }, validateOn: { type: 'array' } },
    events: ['submit', 'error'],
  },
  Field: {
    to: 'UFormField',
    description: 'Labelled form field wrapper. `name` is the path inside the form state.',
    props: { name: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, help: { type: 'string' }, hint: { type: 'string' }, required: { type: 'boolean' }, size: { type: 'string' } },
  },
  Input: { to: 'UInput', description: 'Text input.', props: { placeholder: { type: 'string' }, type: { type: 'string' }, icon: { type: 'string' }, size: { type: 'string' }, disabled: { type: 'boolean' } }, events: ['blur', 'change'] },
  Textarea: { to: 'UTextarea', description: 'Multi-line input.', props: { placeholder: { type: 'string' }, rows: { type: 'number' }, autoresize: { type: 'boolean' } } },
  NumberInput: { to: 'UInputNumber', description: 'Numeric input with steppers.', props: { min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' }, size: { type: 'string' } } },
  Select: { to: 'USelectMenu', description: 'Single or multiple choice from `items`.', props: { items: { type: 'array' }, valueKey: { type: 'string' }, labelKey: { type: 'string' }, placeholder: { type: 'string' }, multiple: { type: 'boolean' } } },
  Checkbox: { to: 'UCheckbox', description: 'Boolean choice.', props: { label: { type: 'string' }, description: { type: 'string' } } },
  CheckboxGroup: { to: 'UCheckboxGroup', description: 'Multiple choice list.', props: { items: { type: 'array' }, valueKey: { type: 'string' }, labelKey: { type: 'string' } } },
  RadioGroup: { to: 'URadioGroup', description: 'Single choice list.', props: { items: { type: 'array' }, valueKey: { type: 'string' }, labelKey: { type: 'string' }, orientation: { type: 'string' }, variant: { type: 'string' } } },
  Switch: { to: 'USwitch', description: 'Toggle.', props: { label: { type: 'string' } } },
  Modal: { to: 'UModal', description: 'Dialog; bind `open` with `model`.', props: { title: { type: 'string' }, description: { type: 'string' } }, slots: ['body', 'footer', 'header'] },
  Drawer: { to: 'UDrawer', description: 'Bottom or side sheet; bind `open` with `model`.', props: { title: { type: 'string' }, direction: { type: 'string' } }, slots: ['body', 'footer'] },
  Table: { to: 'UTable', description: 'Data table.', props: { data: { type: 'array' }, columns: { type: 'array' } } },
  Tabs: { to: 'UTabs', description: 'Tab strip; bind the active value with `model`.', props: { items: { type: 'array' }, color: { type: 'string' }, variant: { type: 'string' }, size: { type: 'string' } } },
  Accordion: { to: 'UAccordion', description: 'Collapsible sections.', props: { items: { type: 'array' } } },
  Progress: { to: 'UProgress', description: 'Progress bar.', props: { value: { type: 'number' }, max: { type: 'number' } } },
  Skeleton: { to: 'USkeleton', description: 'Loading placeholder.' },
  Kbd: { to: 'UKbd', description: 'Keyboard key.', props: { value: { type: 'string' } } },
  Tooltip: { to: 'UTooltip', description: 'Hover hint.', props: { text: { type: 'string' } } },
  Header: { to: 'UHeader', description: 'Page header bar.', slots: ['left', 'right', 'body'], props: { title: { type: 'string' }, to: { type: 'string' } } },
  Main: { to: 'UMain', description: 'Main content area.' },
  Footer: { to: 'UFooter', description: 'Page footer.', slots: ['left', 'right'] },
  Section: { to: 'UPageSection', description: 'Titled page section.', props: { title: { type: 'string' }, description: { type: 'string' }, headline: { type: 'string' }, icon: { type: 'string' } } },
  Hero: { to: 'UPageHero', description: 'Hero block.', props: { title: { type: 'string' }, description: { type: 'string' }, headline: { type: 'string' } }, slots: ['links', 'top'] },
}

export const BASE_COMPONENT_NAMES = Object.keys(BASE_VOCABULARY)

/** Components implemented by the module runtime (they back base names). */
export const RUNTIME_COMPONENT_NAMES = [...new Set(Object.values(BASE_VOCABULARY).map(entry => entry.to).filter(name => name.startsWith('Blueprint')))]

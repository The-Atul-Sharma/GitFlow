interface ModelOptionProps {
  value: string;
  label: string;
}

/** Single <option> in the ModelSwitcher dropdown. Uses an encoded JSON value. */
export function ModelOption({ value, label }: ModelOptionProps) {
  return <option value={value}>{label}</option>;
}

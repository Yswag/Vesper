import { Picker, Text } from "scripting"

export interface GlassFilterOption<T extends string> {
  value: T
  title: string
}

// The native picker owns selection, accessibility and its system material.
export function GlassFilter<T extends string>({ title, value, options, onChanged }: {
  title: string
  value: T
  options: GlassFilterOption<T>[]
  onChanged: (value: T) => void
}) {
  return (
    <Picker title={title} value={value} onChanged={(next: string | number) => {
      const option = options.find(item => item.value === next)
      if (option) onChanged(option.value)
    }} pickerStyle="segmented" frame={{ minHeight: 44 }}>
      {options.map(option => <Text key={option.value} tag={option.value}>{option.title}</Text>)}
    </Picker>
  )
}

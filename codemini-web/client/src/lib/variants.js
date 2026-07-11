import { cn } from "@/lib/utils";

export function variants(base, config = {}) {
  const { variants: groups = {}, defaultVariants = {} } = config;

  return (selection = {}) => {
    const classes = [base];
    for (const [name, values] of Object.entries(groups)) {
      const value = selection[name] ?? defaultVariants[name];
      if (value != null && values[value]) classes.push(values[value]);
    }
    classes.push(selection.className);
    return cn(classes);
  };
}

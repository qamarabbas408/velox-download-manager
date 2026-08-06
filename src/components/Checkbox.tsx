import { Check } from "lucide-react";

export function Checkbox({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={[
        "w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors",
        checked
          ? "bg-signal border-signal text-white"
          : "bg-surface border-line text-transparent hover:border-signal/60",
        className,
      ].join(" ")}
    >
      <Check className="w-3 h-3" strokeWidth={3} />
    </button>
  );
}

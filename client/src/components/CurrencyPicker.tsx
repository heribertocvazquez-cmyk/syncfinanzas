// Selector de moneda del hogar (MXN / USD / EUR), el mismo en la
// creación del hogar y en Hogar. La moneda es del hogar entero, no del
// perfil: todos los perfiles del hogar comparten la misma.
import { CURRENCIES, type HouseholdCurrency } from "../lib/currency";

export function CurrencyPicker({
  value,
  onChange,
  disabled,
}: {
  value: HouseholdCurrency;
  onChange: (c: HouseholdCurrency) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2" role="group" id="moneda-hogar" aria-label="Moneda del hogar">
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            type="button"
            aria-label={`Moneda ${c.code}`}
            aria-pressed={value === c.code}
            disabled={disabled}
            onClick={() => onChange(c.code)}
            className={`rounded-full border px-2 py-2 text-sm font-bold disabled:opacity-50 ${value === c.code ? "bg-[var(--accent)] text-[var(--accent-text)] border-transparent" : "border-[var(--border)] text-[var(--text)]"}`}
          >
            {c.code}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--dim)] mt-1">Peso mexicano · Dólar · Euro</p>
    </div>
  );
}

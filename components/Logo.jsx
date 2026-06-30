const SRC = {
  full: { light: "/logo/logo-horizontal.svg", dark: "/logo/logo-horizontal-on-dark.svg" },
  mark: { light: "/logo/mark.svg", dark: "/logo/mark-on-dark.svg" },
  wordmark: { light: "/logo/wordmark.svg", dark: "/logo/wordmark-on-dark.svg" },
};

export default function Logo({ variant = "full", theme = "light", height = 32, className }) {
  return (
    <img
      src={SRC[variant][theme]}
      alt="ClearTill"
      height={height}
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}

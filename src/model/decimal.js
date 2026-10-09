// Exact nonnegative decimal quantities, stored as JSON-safe strings.
export function decimal(value) {
    const text = String(value).trim();
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    const integer = (whole || "0").replace(/^0+(?=\d)/, "");
    const tail = fraction.replace(/0+$/, "");
    return integer + (tail ? `.${tail}` : "");
}

export function adjustDecimal(balance, change) {
    const signed = String(change).trim();
    if (!/^[+-]/.test(signed)) return null;
    const current = decimal(balance), delta = decimal(signed.slice(1));
    if (current === null || delta === null) return null;
    const [a, af = ""] = current.split("."), [b, bf = ""] = delta.split(".");
    const scale = Math.max(af.length, bf.length);
    const sum = BigInt(a + af.padEnd(scale, "0")) + (signed[0] === "-" ? -1n : 1n) * BigInt(b + bf.padEnd(scale, "0"));
    if (sum < 0n) return null;
    const digits = sum.toString().padStart(scale + 1, "0");
    return decimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}

from .core import Inventory


def format_report(inv: Inventory) -> str:
    lines = [f"{'SKU':<8}{'Name':<16}{'Qty':>5}{'Value':>10}"]
    for sku in sorted(inv.items):
        item = inv.items[sku]
        lines.append(f"{sku:<8}{item.name:<16}{item.quantity:>5}{item.subtotal():>10.2f}")
    lines.append(f"{'TOTAL':<29}{inv.total_value():>10.2f}")
    return "\n".join(lines)

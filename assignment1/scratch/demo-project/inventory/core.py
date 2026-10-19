from dataclasses import dataclass, field


@dataclass
class Item:
    sku: str
    name: str
    price: float
    quantity: int = 0

    def subtotal(self) -> float:
        return self.price * self.quantity


@dataclass
class Inventory:
    items: dict = field(default_factory=dict)

    def add(self, item: Item) -> None:
        if item.sku in self.items:
            self.items[item.sku].quantity += item.quantity
        else:
            self.items[item.sku] = item

    def remove(self, sku: str, quantity: int) -> None:
        if sku not in self.items:
            raise KeyError(sku)
        item = self.items[sku]
        if quantity > item.quantity:
            raise ValueError("not enough stock")
        item.quantity -= quantity

    def total_value(self) -> float:
        return sum(item.subtotal() for item in self.items.values())

    def low_stock(self, threshold: int = 5) -> list:
        """Return SKUs whose quantity is at or below the threshold, sorted."""
        return sorted(sku for sku, item in self.items.items() if item.quantity < threshold)

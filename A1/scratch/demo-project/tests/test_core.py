import pytest
from inventory import Item, Inventory


def make():
    inv = Inventory()
    inv.add(Item("A1", "Widget", 2.5, 10))
    inv.add(Item("B2", "Gadget", 10.0, 5))
    inv.add(Item("C3", "Doohickey", 1.0, 2))
    return inv


def test_add_merges_quantity():
    inv = make()
    inv.add(Item("A1", "Widget", 2.5, 3))
    assert inv.items["A1"].quantity == 13


def test_remove_too_many():
    inv = make()
    with pytest.raises(ValueError):
        inv.remove("C3", 5)


def test_total_value():
    assert make().total_value() == pytest.approx(77.0)


def test_low_stock_includes_threshold():
    # Items exactly at the threshold count as low stock.
    assert make().low_stock(threshold=5) == ["B2", "C3"]

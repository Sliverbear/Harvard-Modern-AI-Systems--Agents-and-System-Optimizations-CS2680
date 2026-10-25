from inventory import Item, Inventory
from inventory.report import format_report


def test_report_has_total_line():
    inv = Inventory()
    inv.add(Item("A1", "Widget", 2.5, 4))
    report = format_report(inv)
    assert report.splitlines()[-1].endswith("10.00")

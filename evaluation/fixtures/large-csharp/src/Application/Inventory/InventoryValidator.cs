namespace Demo.Application.Inventory;
public sealed class InventoryValidator {
 public void Validate(string sku) { if (sku.Length == 0) throw new ArgumentException(); }
}

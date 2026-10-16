namespace Demo.Application.Shipping;
public sealed class ShipmentValidator {
 public void Validate(string shipmentId) { if (shipmentId.Length == 0) throw new ArgumentException(); }
}

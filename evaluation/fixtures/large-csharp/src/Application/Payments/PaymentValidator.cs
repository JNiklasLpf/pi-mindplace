namespace Demo.Application.Payments;
public sealed class PaymentValidator {
 public void Validate(string paymentId) { if (paymentId.Length < 4) throw new ArgumentException(); }
}

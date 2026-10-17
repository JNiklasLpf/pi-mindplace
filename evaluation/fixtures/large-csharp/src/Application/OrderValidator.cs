namespace Demo.Application;
public sealed class OrderValidator {
 public void Validate(Order order) { if (order.Total < 0) throw new ArgumentOutOfRangeException(); }
}

namespace Demo.Application;
public sealed class OrderPolicy {
 public void EnsureSubmissionAllowed(Order order) {
  if (order.Total == 0) throw new InvalidOperationException("Empty orders cannot be submitted.");
 }
}

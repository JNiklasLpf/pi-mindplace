namespace Demo.Application;
public sealed class OrderSubmissionHandler(OrderPolicy policy, OrderService service) {
 public Task HandleAsync(Order order) {
  policy.EnsureSubmissionAllowed(order);
  return service.SubmitAsync(order);
 }
}

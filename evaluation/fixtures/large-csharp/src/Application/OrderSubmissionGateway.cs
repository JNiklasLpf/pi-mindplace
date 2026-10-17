namespace Demo.Application;
public sealed class OrderSubmissionGateway(OrderSubmissionHandler handler) {
 public Task SubmitAsync(Order order) => handler.HandleAsync(order);
}

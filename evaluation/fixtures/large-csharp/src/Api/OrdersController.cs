using Demo.Application;
namespace Demo.Api;
public sealed class OrdersController(OrderSubmissionGateway gateway) {
 public Task Submit(Order order) => gateway.SubmitAsync(order);
}

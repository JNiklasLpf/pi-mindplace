using Demo.Infrastructure;
namespace Demo.Application;
public sealed class OrderService(OrderValidator validator, IOrderRepository repository) {
 public async Task SubmitAsync(Order order) {
  validator.Validate(order);
  await repository.SaveAsync(order);
 }
}

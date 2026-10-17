namespace Demo.Infrastructure;
public sealed class OrderRepository : IOrderRepository {
 public Task SaveAsync(Demo.Application.Order order) => Task.CompletedTask;
}

namespace Demo.Infrastructure;
public interface IOrderRepository {
 Task SaveAsync(Demo.Application.Order order);
}

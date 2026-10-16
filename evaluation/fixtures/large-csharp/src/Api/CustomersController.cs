using Demo.Application;
namespace Demo.Api;
public sealed class CustomersController(CustomerService service) {
 public Task Get(string id) => service.GetAsync(id);
}

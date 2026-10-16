namespace Demo.Application;
public sealed class CustomerService {
 public Task<string> GetAsync(string id) => Task.FromResult(id);
}

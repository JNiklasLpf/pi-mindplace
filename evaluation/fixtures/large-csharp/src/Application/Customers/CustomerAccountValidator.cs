namespace Demo.Application.Customers;
public sealed class CustomerAccountValidator {
 public void Validate(string account) { if (account.Length < 2) throw new ArgumentException(); }
}

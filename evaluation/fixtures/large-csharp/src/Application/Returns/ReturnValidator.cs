namespace Demo.Application.Returns;
public sealed class ReturnValidator {
 public void Validate(string returnId) { if (string.IsNullOrWhiteSpace(returnId)) throw new ArgumentException(); }
}

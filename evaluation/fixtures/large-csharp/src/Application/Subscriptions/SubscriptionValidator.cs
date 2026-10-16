namespace Demo.Application.Subscriptions;
public sealed class SubscriptionValidator {
 public void Validate(string subscriptionId) { if (subscriptionId.Length < 5) throw new ArgumentException(); }
}

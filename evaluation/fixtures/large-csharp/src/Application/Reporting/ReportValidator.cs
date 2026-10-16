namespace Demo.Application.Reporting;
public sealed class ReportValidator {
 public void Validate(string reportId) { if (reportId.Length == 0) throw new ArgumentException(); }
}

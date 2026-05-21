<?php
/**
 * Template Name: お問い合わせ
 * お問い合わせページテンプレート
 * Contact Form 7 または WPForms との連携を想定
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">

	<!-- ページヒーロー（コンパクト） -->
	<section class="fs-page-hero fs-page-hero--compact">
		<div class="fs-page-hero__bg">
			<div class="fs-page-hero__overlay fs-page-hero__overlay--light"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<p class="fs-page-hero__label">Contact</p>
			<h1 class="fs-page-hero__title">お問い合わせ</h1>
		</div>
	</section>

	<!-- お問い合わせフォーム -->
	<section class="fs-contact fs-section">
		<div class="fs-container">
			<div class="fs-contact__layout">

				<!-- フォーム本体 -->
				<div class="fs-contact__form-area">
					<p class="fs-contact__lead">
						キッチンカーの出展・誘致に関するご質問、ご相談はこちらからお気軽にお問い合わせください。<br>
						担当者より2営業日以内にご連絡いたします。
					</p>

					<?php if ( get_the_content() ) : ?>
						<!-- Contact Form 7 等のショートコードが投稿本文に含まれる想定 -->
						<div class="fs-contact__form">
							<?php
							while ( have_posts() ) :
								the_post();
								the_content();
							endwhile;
							?>
						</div>
					<?php else : ?>
						<!-- フォームプラグイン未設定時のフォールバック -->
						<form class="fs-contact__form" method="post" action="#">
							<div class="fs-form-group">
								<label for="contact-type" class="fs-form-label">お問い合わせ種別 <span class="fs-form-required">必須</span></label>
								<select id="contact-type" name="contact_type" class="fs-form-select" required>
									<option value="">選択してください</option>
									<option value="exhibit">キッチンカーで出展したい</option>
									<option value="start">キッチンカーを始めたい</option>
									<option value="invite">キッチンカーを呼びたい（施設オーナー）</option>
									<option value="event">イベントにキッチンカーを呼びたい</option>
									<option value="other">その他</option>
								</select>
							</div>

							<div class="fs-form-row">
								<div class="fs-form-group">
									<label for="contact-name" class="fs-form-label">お名前 <span class="fs-form-required">必須</span></label>
									<input type="text" id="contact-name" name="name" class="fs-form-input" placeholder="山田 太郎" required>
								</div>
								<div class="fs-form-group">
									<label for="contact-company" class="fs-form-label">会社名・団体名</label>
									<input type="text" id="contact-company" name="company" class="fs-form-input" placeholder="株式会社○○">
								</div>
							</div>

							<div class="fs-form-row">
								<div class="fs-form-group">
									<label for="contact-email" class="fs-form-label">メールアドレス <span class="fs-form-required">必須</span></label>
									<input type="email" id="contact-email" name="email" class="fs-form-input" placeholder="info@example.com" required>
								</div>
								<div class="fs-form-group">
									<label for="contact-tel" class="fs-form-label">電話番号</label>
									<input type="tel" id="contact-tel" name="tel" class="fs-form-input" placeholder="03-1234-5678">
								</div>
							</div>

							<div class="fs-form-group">
								<label for="contact-message" class="fs-form-label">お問い合わせ内容 <span class="fs-form-required">必須</span></label>
								<textarea id="contact-message" name="message" class="fs-form-textarea" rows="8" placeholder="お問い合わせ内容をご記入ください" required></textarea>
							</div>

							<div class="fs-form-group">
								<label class="fs-form-checkbox">
									<input type="checkbox" name="privacy" required>
									<span><a href="<?php echo esc_url( home_url( '/privacy-policy/' ) ); ?>" target="_blank">プライバシーポリシー</a>に同意する</span>
								</label>
							</div>

							<div class="fs-form-submit">
								<button type="submit" class="fs-btn fs-btn--primary fs-btn--large">
									送信する
									<span class="fs-btn__arrow">&rarr;</span>
								</button>
							</div>
						</form>
					<?php endif; ?>
				</div>

				<!-- サイドバー -->
				<aside class="fs-contact__sidebar">
					<div class="fs-contact__info-card">
						<h3>お電話でのお問い合わせ</h3>
						<p class="fs-contact__phone">03-XXXX-XXXX</p>
						<p class="fs-contact__hours">受付時間：平日 10:00〜18:00</p>
					</div>

					<div class="fs-contact__info-card">
						<h3>よくあるご質問</h3>
						<ul class="fs-contact__faq-links">
							<li><a href="#">出展に必要な資格はありますか？</a></li>
							<li><a href="#">誘致にかかる費用を教えてください</a></li>
							<li><a href="#">対応エリアはどこですか？</a></li>
							<li><a href="#">イベントの何日前までに申し込めばいいですか？</a></li>
						</ul>
					</div>
				</aside>

			</div>
		</div>
	</section>

</main>

<?php get_footer(); ?>

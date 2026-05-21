<?php
/**
 * 404エラーページ
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">
	<section class="fs-page-hero fs-page-hero--compact">
		<div class="fs-page-hero__bg">
			<div class="fs-page-hero__overlay fs-page-hero__overlay--light"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<p class="fs-page-hero__label">404 Not Found</p>
			<h1 class="fs-page-hero__title">ページが見つかりません</h1>
		</div>
	</section>

	<section class="fs-section">
		<div class="fs-container" style="text-align: center; max-width: 600px;">
			<p style="margin-bottom: 40px; color: var(--fs-text-light);">
				お探しのページは移動または削除された可能性があります。<br>
				以下のリンクからお探しの情報をご確認ください。
			</p>
			<div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fs-btn fs-btn--primary">トップページへ</a>
				<a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>" class="fs-btn fs-btn--secondary">お問い合わせ</a>
			</div>
		</div>
	</section>
</main>

<?php get_footer(); ?>
